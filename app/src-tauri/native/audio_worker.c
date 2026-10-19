// macOS-only scheduling and wake-up shim. Built inside Docker against the SDK.
#include <AudioToolbox/AudioWorkInterval.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <mach/thread_policy.h>
#include <pthread.h>
#include <stdlib.h>

// A semaphore is created before playback. The callback only signals it; it never waits.
int vira_semaphore_create(unsigned int *out) {
    return semaphore_create(mach_task_self(), out, SYNC_POLICY_FIFO, 0);
}
int vira_semaphore_signal(unsigned int sem) { return semaphore_signal(sem); }
int vira_semaphore_wait(unsigned int sem) {
    mach_timespec_t limit = {0, 100000000}; // cancellation/watchdog bound, not polling cadence
    return semaphore_timedwait(sem, limit);
}
void vira_semaphore_destroy(unsigned int sem) { semaphore_destroy(mach_task_self(), sem); }

typedef struct {
    os_workgroup_interval_t group;
    os_workgroup_join_token_s token;
    mach_timebase_info_data_t timebase;
    unsigned int period;
    unsigned int rate;
    int joined;
    int interval;
} vira_worker;

void *vira_worker_create(unsigned int frames, unsigned int rate, int *error) {
    vira_worker *w = calloc(1, sizeof(*w));
    if (!w) { *error = -1; return NULL; }
    w->rate = rate;
    mach_timebase_info(&w->timebase);
    w->period = (uint64_t)frames * 1000000000 / w->rate * w->timebase.denom / w->timebase.numer;
    // This worker runs ahead via a queue, not in lockstep with the I/O callback.
    w->group = AudioWorkIntervalCreate("Vira audio producer", OS_CLOCK_MACH_ABSOLUTE_TIME, NULL);
    if (!w->group) { *error = -2; free(w); return NULL; }
    *error = 0;
    return w;
}
int vira_worker_activate(vira_worker *w) {
    thread_time_constraint_policy_data_t policy = {w->period, w->period * 3 / 4, w->period, 1};
    int err = thread_policy_set(pthread_mach_thread_np(pthread_self()), THREAD_TIME_CONSTRAINT_POLICY,
        (thread_policy_t)&policy, THREAD_TIME_CONSTRAINT_POLICY_COUNT);
    if (err) return err;
    err = os_workgroup_join(w->group, &w->token);
    if (!err) w->joined = 1;
    return err;
}
int vira_worker_begin(vira_worker *w, unsigned int queued_frames) {
    uint64_t now = mach_absolute_time();
    uint64_t remaining = (uint64_t)queued_frames * 1000000000 / w->rate * w->timebase.denom / w->timebase.numer;
    int err = os_workgroup_interval_start(w->group, now, now + (remaining ? remaining : w->period), NULL);
    if (!err) w->interval = 1;
    return err;
}
int vira_worker_finish(vira_worker *w) {
    if (!w->interval) return 0;
    w->interval = 0;
    return os_workgroup_interval_finish(w->group, NULL);
}
int vira_worker_is_realtime(void) {
    thread_time_constraint_policy_data_t policy = {0};
    mach_msg_type_number_t count = THREAD_TIME_CONSTRAINT_POLICY_COUNT;
    boolean_t default_policy = 0;
    int err = thread_policy_get(pthread_mach_thread_np(pthread_self()), THREAD_TIME_CONSTRAINT_POLICY,
        (thread_policy_t)&policy, &count, &default_policy);
    return err == 0 && !default_policy && policy.computation > 0;
}
void vira_worker_destroy(vira_worker *w) {
    if (!w) return;
    vira_worker_finish(w);
    if (w->joined) os_workgroup_leave(w->group, &w->token);
    thread_standard_policy_data_t policy = {0};
    thread_policy_set(pthread_mach_thread_np(pthread_self()), THREAD_STANDARD_POLICY,
        (thread_policy_t)&policy, THREAD_STANDARD_POLICY_COUNT);
    os_release(w->group);
    free(w);
}

// Discovery must not instantiate input Audio Units: that can request mic access.
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
int vira_input_devices(void (*visit)(const char *, unsigned int, void *), void *context) {
    AudioObjectPropertyAddress address = {kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size);
    if (status) return status;
    AudioDeviceID *devices = malloc(size);
    if (!devices) return -1;
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, devices);
    if (status) { free(devices); return status; }
    for (UInt32 i = 0; i < size / sizeof(*devices); ++i) {
        AudioObjectPropertyAddress config = {kAudioDevicePropertyStreamConfiguration,
            kAudioObjectPropertyScopeInput, kAudioObjectPropertyElementMain};
        UInt32 bytes = 0;
        if (AudioObjectGetPropertyDataSize(devices[i], &config, 0, NULL, &bytes) || !bytes) continue;
        AudioBufferList *buffers = malloc(bytes);
        if (!buffers) continue;
        unsigned int channels = 0;
        if (!AudioObjectGetPropertyData(devices[i], &config, 0, NULL, &bytes, buffers))
            for (UInt32 j = 0; j < buffers->mNumberBuffers; ++j) channels += buffers->mBuffers[j].mNumberChannels;
        free(buffers);
        if (!channels) continue;
        AudioObjectPropertyAddress label = {kAudioObjectPropertyName,
            kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
        CFStringRef name = NULL;
        UInt32 length = sizeof(name);
        if (AudioObjectGetPropertyData(devices[i], &label, 0, NULL, &length, &name) || !name) continue;
        CFIndex capacity = CFStringGetMaximumSizeForEncoding(CFStringGetLength(name), kCFStringEncodingUTF8) + 1;
        char *text = malloc(capacity);
        if (text && CFStringGetCString(name, text, capacity, kCFStringEncodingUTF8)) visit(text, channels, context);
        free(text);
        CFRelease(name);
    }
    free(devices);
    return 0;
}
