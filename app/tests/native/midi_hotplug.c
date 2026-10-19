// Cross-build in Docker; run on macOS to exercise real CoreMIDI hot-plug and input.
#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <pthread.h>
#include <spawn.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
extern void *vira_midi_open_raw(void (*)(void *, const UInt8 *, size_t, uint64_t), void *);
extern void vira_midi_close(void *);
extern size_t vira_midi_count(bool);
extern bool vira_midi_endpoint(bool, size_t, int32_t *, char *, size_t);
extern int vira_midi_select(void *, int32_t, int32_t);
#ifdef VIRA_TEST_INITIALIZE
extern int vira_midi_initialize(void);
#endif
static atomic_int received, appeared, disappeared;
static const char *test_name = "VIRA hotplug regression source";

static void receive(void *context, const UInt8 *bytes, size_t len, uint64_t ns) {
    (void)context; (void)ns;
    if (len == 3 && bytes[0] == 0xb0 && bytes[1] == 7 && (bytes[2] == 99 || bytes[2] == 98)) atomic_fetch_or(&received, bytes[2] == 99 ? 1 : 2);
}
static void *watch(void *unused) {
    (void)unused;
    void *input = vira_midi_open_raw(receive, NULL);
    bool connected = false;
    for (int tick = 0; tick < 800; tick++) {
        bool found = false;
        for (size_t i = 0; i < vira_midi_count(false); i++) {
            int32_t id; char name[256];
            if (vira_midi_endpoint(false, i, &id, name, sizeof(name)) && !strcmp(name, test_name)) {
                found = true;
                if (!connected && vira_midi_select(input, id, 0) == 0) { connected = true; atomic_fetch_add(&appeared, 1); }
            }
        }
        if (!found && connected) {
            connected = false; atomic_fetch_add(&disappeared, 1);
            vira_midi_close(input); input = vira_midi_open_raw(receive, NULL);
        }
        usleep(10000);
    }
    vira_midi_close(input);
    return NULL;
}
int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "--source")) {
        MIDIClientRef client; MIDIEndpointRef source;
        if (MIDIClientCreate(CFSTR("VIRA hotplug test"), NULL, NULL, &client) != noErr) return 2;
        for (int cycle = 0; cycle < 2; cycle++) {
            usleep(700000);
            if (MIDISourceCreate(client, CFSTR("VIRA hotplug regression source"), &source) != noErr) return 2;
            MIDIObjectSetIntegerProperty(source, kMIDIPropertyUniqueID, -1213482031);
            for (int i = 0; i < 20; i++) {
                usleep(100000);
                MIDIPacketList list; const Byte bytes[] = {0xb0, 7, (Byte)(99 - cycle)};
                MIDIPacketListAdd(&list, sizeof(list), MIDIPacketListInit(&list), 0, 3, bytes);
                MIDIReceived(source, &list);
            }
            MIDIEndpointDispose(source);
        }
        MIDIClientDispose(client);
        return 0;
    }
#ifdef VIRA_TEST_INITIALIZE
    if (vira_midi_initialize() != noErr) return 2;
#endif
    pthread_t worker; pthread_create(&worker, NULL, watch, NULL);
    pid_t child; char *args[] = {argv[0], "--source", NULL};
    if (posix_spawn(&child, argv[0], NULL, NULL, args, environ) != 0) return 2;
    double until = CFAbsoluteTimeGetCurrent() + 8.5;
    while (CFAbsoluteTimeGetCurrent() < until) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, .01, false);
        usleep(1000);
    }
    pthread_join(worker, NULL); waitpid(child, NULL, 0);
    printf("hotplug appeared=%d received_cc=%d disappeared=%d\n", atomic_load(&appeared), atomic_load(&received), atomic_load(&disappeared));
    return !(atomic_load(&appeared) == 2 && atomic_load(&received) == 3 && atomic_load(&disappeared) == 2);
}
