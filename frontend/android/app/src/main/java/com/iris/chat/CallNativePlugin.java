package com.iris.chat;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Native side of calls (lib/call/native.ts):
 *  - audio routing: communication mode, earpiece vs loudspeaker (a connected
 *    headset wins over the earpiece);
 *  - picture-in-picture: while JS has it enabled (an active video call), leaving
 *    the app shrinks it into a system PiP window instead of hiding the call.
 */
@CapacitorPlugin(name = "CallNative")
public class CallNativePlugin extends Plugin {

    private static CallNativePlugin instance;

    private boolean pipEnabled = false;
    private Rational aspect = new Rational(9, 16);

    @Override
    public void load() {
        instance = this;
    }

    // ── audio ──────────────────────────────────────────────────────

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void startAudio(PluginCall call) {
        AudioManager am = audio();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        route(am, call.getBoolean("speaker", false));
        call.resolve();
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        route(audio(), call.getBoolean("on", false));
        call.resolve();
    }

    @PluginMethod
    public void stopAudio(PluginCall call) {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.clearCommunicationDevice();
        } else {
            am.setSpeakerphoneOn(false);
        }
        am.setMode(AudioManager.MODE_NORMAL);
        call.resolve();
    }

    private static final int[] PRIVATE_OUTPUTS = {
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
    };

    private void route(AudioManager am, boolean speaker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            AudioDeviceInfo target = null;
            if (speaker) {
                target = find(devices, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
            } else {
                for (int type : PRIVATE_OUTPUTS) {
                    target = find(devices, type);
                    if (target != null) break;
                }
            }
            if (target != null) am.setCommunicationDevice(target);
        } else {
            am.setSpeakerphoneOn(speaker);
        }
    }

    private static AudioDeviceInfo find(List<AudioDeviceInfo> devices, int type) {
        for (AudioDeviceInfo d : devices) if (d.getType() == type) return d;
        return null;
    }

    // ── picture-in-picture ─────────────────────────────────────────

    @PluginMethod
    public void setPip(PluginCall call) {
        pipEnabled = call.getBoolean("enabled", false);
        Integer w = call.getInt("width");
        Integer h = call.getInt("height");
        if (w != null && h != null && w > 0 && h > 0) aspect = new Rational(w, h);
        Activity activity = getActivity();
        if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.runOnUiThread(() -> activity.setPictureInPictureParams(params()));
        }
        call.resolve();
    }

    private PictureInPictureParams params() {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(aspect);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: the system enters PiP itself on the home gesture.
            b.setAutoEnterEnabled(pipEnabled).setSeamlessResizeEnabled(true);
        }
        return b.build();
    }

    /** Pre-Android-12 path: MainActivity forwards onUserLeaveHint here. */
    static void handleUserLeaveHint(Activity activity) {
        CallNativePlugin p = instance;
        if (p == null || !p.pipEnabled) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            try {
                activity.enterPictureInPictureMode(p.params());
            } catch (IllegalStateException ignored) {
                // Activity not in a state that allows PiP; the call just keeps running.
            }
        }
    }

    static void handlePipChanged(boolean active) {
        CallNativePlugin p = instance;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("active", active);
        p.notifyListeners("pipChange", data, true);
    }
}
