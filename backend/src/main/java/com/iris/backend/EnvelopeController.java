package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * HTTP twin of the WebSocket `sync` / `ack` frames, for the mobile app when a data-only push woke it with no
 * socket open (it must not go "online" just to read a notification). Same rules as the socket: a device only
 * ever sees and acks its own envelopes, and the device must belong to the caller.
 */
@RestController
@RequestMapping("/api/signal/envelopes")
public class EnvelopeController {

    private final EnvelopeService envelopes;
    private final DeviceRepository devices;

    public EnvelopeController(EnvelopeService envelopes, DeviceRepository devices) {
        this.envelopes = envelopes;
        this.devices = devices;
    }

    /** Same JSON as the socket's `envelope` frame; `body` is null in the metadata-only lookup. */
    public record EnvelopeFrame(String type, Long envelopeId, int envType, String body, OutgoingMessage message) {
        static EnvelopeFrame of(EnvelopeService.Pending p, boolean withBody) {
            return new EnvelopeFrame("envelope", p.envelope().getId(), p.envelope().getType(),
                withBody ? p.envelope().getBody() : null, OutgoingMessage.of(p.message()));
        }
    }

    public record AckRequest(Integer device, List<Long> ids) { }

    private boolean ownDevice(Authentication auth, Integer device) {
        return device != null && devices.existsByUsernameAndDeviceId(auth.getName(), device);
    }

    /** Everything still queued for this device, oldest first (what `sync` would deliver). */
    @GetMapping
    public ResponseEntity<List<EnvelopeFrame>> pending(@RequestParam Integer device, Authentication auth) {
        if (!ownDevice(auth, device)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        return ResponseEntity.ok(envelopes.pendingFor(auth.getName(), device).stream()
            .map(p -> EnvelopeFrame.of(p, true)).toList());
    }

    /**
     * Metadata of one queued envelope (sender, sender device, group, media id...) without the ciphertext: the
     * push already carried it, and the metadata is exactly what must not travel through FCM.
     * 404 = already acked (another path handled it) or not this device's.
     */
    @GetMapping("/{envelopeId}")
    public ResponseEntity<EnvelopeFrame> meta(@PathVariable long envelopeId, @RequestParam Integer device, Authentication auth) {
        if (!ownDevice(auth, device)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        return envelopes.pendingOne(auth.getName(), device, envelopeId)
            .map(p -> ResponseEntity.ok(EnvelopeFrame.of(p, false)))
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/ack")
    public ResponseEntity<Void> ack(@RequestBody AckRequest req, Authentication auth) {
        if (!ownDevice(auth, req.device())) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        if (req.ids() == null || req.ids().size() > 500) return ResponseEntity.badRequest().build();
        envelopes.ack(req.ids(), auth.getName(), req.device());
        return ResponseEntity.noContent().build();
    }
}
