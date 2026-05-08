package com.iris.backend;

import java.util.List;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class MessageController {

    private final MessageRepository messageRepository;
    public MessageController(MessageRepository messageRepository) {
        this.messageRepository = messageRepository;
    }
    
    @GetMapping("/messages")
    public List<OutgoingMessage> getMessages(Authentication auth, @RequestParam("with") String with) {
        String me = auth.getName();

        return messageRepository.findConversation(me, with).stream()
            .map(m -> new OutgoingMessage(
                m.getId(),
                m.getSender(),
                m.getRecipient(),
                m.getContent(),
                m.getEncryptedKeyForSender(),
                m.getEncryptedKeyForRecipient(),
                m.getMediaId(),
                m.getMimeType(),
                m.isViewOnce(),
                m.getViewedAt(),
                m.getSentAt(),
                m.getReplyToId()
            ))
            .toList();
    }

}
