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

        // v2 rows come back as metadata only (empty content): their plaintext lives
        // on the participants' devices, not here.
        return messageRepository.findConversation(me, with).stream()
            .map(OutgoingMessage::of)
            .toList();
    }

}
