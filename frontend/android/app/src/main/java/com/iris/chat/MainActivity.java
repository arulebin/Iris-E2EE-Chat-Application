package com.iris.chat;

import android.content.res.Configuration;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenSecurityPlugin.class);
        registerPlugin(KeystorePlugin.class);
        registerPlugin(AppLockPlugin.class);
        registerPlugin(CallNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Secure by default from the first frame (splash + recents thumbnail),
        // before the web layer has loaded. lib/screenSecurity.ts clears it if
        // the user turned "Screen security" off and no snap is open.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    // Leaving the app mid video call → system picture-in-picture (pre-Android 12;
    // newer versions auto-enter via PictureInPictureParams).
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        CallNativePlugin.handleUserLeaveHint(this);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        CallNativePlugin.handlePipChanged(isInPictureInPictureMode);
    }
}
