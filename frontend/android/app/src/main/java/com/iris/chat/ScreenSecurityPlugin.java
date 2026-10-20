package com.iris.chat;

import android.app.Activity;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Toggles FLAG_SECURE on the app window. While set, Android blocks screenshots
 * and screen recording of the app and shows a blank tile in the recents
 * switcher. Reference counting lives in JS (lib/screenSecurity.ts); this side
 * only flips the flag.
 */
@CapacitorPlugin(name = "ScreenSecurity")
public class ScreenSecurityPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        setSecure(true, call);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        setSecure(false, call);
    }

    private void setSecure(boolean secure, PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            if (secure) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }
}
