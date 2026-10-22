#include <IOKit/pwr_mgt/IOPMLib.h>

int vira_keep_awake_create(int display, IOPMAssertionID *assertion) {
    return IOPMAssertionCreateWithName(
        display ? kIOPMAssertionTypePreventUserIdleDisplaySleep
                : kIOPMAssertionTypePreventUserIdleSystemSleep,
        kIOPMAssertionLevelOn, CFSTR("VIRA is open"), assertion);
}

int vira_keep_awake_activity(IOPMAssertionID *assertion) {
    // Reusing the ID renews the activity timeout without accumulating assertions.
    return IOPMAssertionDeclareUserActivity(
        CFSTR("VIRA active session"), kIOPMUserActiveLocal, assertion);
}

void vira_keep_awake_release(IOPMAssertionID assertion) {
    IOPMAssertionRelease(assertion);
}
