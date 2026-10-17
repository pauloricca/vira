"""Deck loads reserve the service until native PCM/timing installation finishes."""
import threading
import time


class LoadPriority:
    def __init__(self):
        self.condition = threading.Condition()
        self.leases = {}

    def update(self, body):
        if (not isinstance(body, dict) or set(body) != {"token", "active"}
                or not isinstance(body["token"], str) or not 1 <= len(body["token"]) <= 128
                or any(c not in "0123456789abcdef-" for c in body["token"])
                or type(body["active"]) is not bool):
            raise ValueError("Invalid deck load priority request.")
        with self.condition:
            if body["active"]:
                # A crashed app must not leave background work suspended forever.
                self.leases[body["token"]] = time.monotonic() + 300
            else:
                self.leases.pop(body["token"], None)
            self.condition.notify_all()

    def background(self):
        with self.condition:
            while True:
                now = time.monotonic()
                self.leases = {key: end for key, end in self.leases.items() if end > now}
                if not self.leases:
                    return
                self.condition.wait(timeout=min(self.leases.values()) - now)


def priority_request(handler, priority):
    try:
        import json
        length = int(handler.headers.get("Content-Length", "0"))
        if not 0 < length <= 1024 or handler.headers.get("Transfer-Encoding"):
            raise ValueError("Invalid deck load priority request.")
        priority.update(json.loads(handler.rfile.read(length)))
        handler.respond(200, {"ok": True})
    except (ValueError, OSError) as exc:
        handler.respond(400, {"error": str(exc)})
