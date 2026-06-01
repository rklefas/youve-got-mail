speechSynthesis.addEventListener("voiceschanged", () => {
  speechSynthesis.getVoices();
});

async function* iterateMessagePages(messageList) {
  let page = messageList;

  do {
    for (const message of page.messages) {
      yield message;
    }
    page = page.id ? await messenger.messages.continueList(page.id) : null;
  } while (page);
}

function formatSenderLabel(author) {
  if (!author) {
    return "unknown sender";
  }

  if (typeof messenger.messages.parseMailboxString === "function") {
    const parsed = messenger.messages.parseMailboxString(author);
    if (parsed?.name) {
      return parsed.name;
    }
    if (parsed?.email) {
      return parsed.email;
    }
  }

  const match = author.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, "").trim();
    return name || match[2].trim();
  }

  return author;
}

function speak(text) {

  var betterText = text.replace(' | ', '; ');

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(betterText);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

async function announceMessages(messageList) {

  if (!messageList?.messages?.length) {
    return;
  }

  for await (const message of iterateMessagePages(messageList)) {
    const sender = formatSenderLabel(message.author);
    await speak(`You've got mail from ${sender}`);

    if (message.subject) {
      await speak(`Subject.`);
      await speak(message.subject);
    }
  }
}

messenger.messages.onNewMailReceived.addListener((_folder, messageList) => {
  announceMessages(messageList).catch((error) => {
    console.error("You've Got Mail (onNewMailReceived):", error);
  });
});

messenger.messageDisplay.onMessagesDisplayed.addListener((_tab, messageList) => {
  return;

  announceMessages(messageList).catch((error) => {
    console.error("You've Got Mail (onMessagesDisplayed):", error);
  });
});
