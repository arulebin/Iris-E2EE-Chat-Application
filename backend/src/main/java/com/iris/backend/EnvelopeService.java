package com.iris.backend;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Persistence for v2 messages: one metadata row + one ciphertext per target device. */
@Service
public class EnvelopeService {

    private final MessageRepository messageRepository;
    private final MessageEnvelopeRepository envelopeRepository;

    public EnvelopeService(MessageRepository messageRepository, MessageEnvelopeRepository envelopeRepository) {
        this.messageRepository = messageRepository;
        this.envelopeRepository = envelopeRepository;
    }

    public record Stored(Message message, List<MessageEnvelope> envelopes) { }

    /** Saved atomically: a message is never visible without all of its envelopes. */
    @Transactional
    public Stored saveV2(Message message, List<IncomingMessage.Envelope> envelopes) {
        Message saved = messageRepository.save(message);
        List<MessageEnvelope> rows = envelopeRepository.saveAll(envelopes.stream()
            .map(e -> new MessageEnvelope(saved.getId(), e.user(), e.deviceId(), e.type(), e.body()))
            .toList());
        return new Stored(saved, rows);
    }

    public record Pending(MessageEnvelope envelope, Message message) { }

    /** Undelivered envelopes for one device, oldest first, with their message metadata. */
    public List<Pending> pendingFor(String user, int deviceId) {
        List<MessageEnvelope> envelopes = envelopeRepository.findByTargetUserAndTargetDeviceIdOrderByIdAsc(user, deviceId);
        if (envelopes.isEmpty()) return List.of();
        Map<Long, Message> messages = messageRepository
            .findAllById(envelopes.stream().map(MessageEnvelope::getMessageId).distinct().toList())
            .stream()
            .collect(Collectors.toMap(Message::getId, Function.identity()));
        return envelopes.stream()
            .filter(e -> messages.containsKey(e.getMessageId()))
            .map(e -> new Pending(e, messages.get(e.getMessageId())))
            .toList();
    }

    public int ack(Collection<Long> ids, String user, int deviceId) {
        if (ids.isEmpty()) return 0;
        return envelopeRepository.ack(ids, user, deviceId);
    }
}
