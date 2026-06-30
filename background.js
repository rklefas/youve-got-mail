speechSynthesis.addEventListener("voiceschanged", () => {
  speechSynthesis.getVoices();
});

// --------------------
// Look at account
// --------------------

async function getFolderIdByName(mailboxName) {

  if (!mailboxName) {
    console.warn('getFolderIdByName: mailboxName required');
    return null;
  }

  console.log('getFolderIdByName: looking for', mailboxName);
  const folders = await messenger.folders.query();

  // const sampleFolders = folders.slice(0, 10).map((f) => ({id: f.id, name: f.name, path: f.path, canAddSubfolders: f.canAddSubfolders, accountId: f.accountId}));
  // console.log('getFolderIdByName: sample folders', sampleFolders);

  const targetName = mailboxName.toUpperCase();
  const folder = folders.find((f) => f && (
    f.name === mailboxName ||
    f.path === mailboxName ||
    f.name?.toUpperCase() === targetName ||
    f.path?.toUpperCase() === targetName
  ));

  if (!folder) {
    console.log('getFolderIdByName: not found', mailboxName);
    return null;
  }

  return folder.id;
}


async function findSpecialFolders()
{
  speak('Looking for priority folders to organize');

  const allFolders = await messenger.folders.query();
  // prefer exact or exact-prefix match, PRIORITY folders
  const foundFolders = allFolders.filter((f) => f && f.path.startsWith('/PRIORITY-') && f.name.startsWith('PRIORITY-'));

  return foundFolders;
}


async function findRebuildableFolders()
{
  speak('Looking for folders to rebuild');

  const allFolders = await messenger.folders.query();
  // prefer exact or exact-prefix match, PRIORITY folders
  const nameFolders = allFolders.filter((f) => f && f.name && f.name.includes('[REBUILD]'));
//  const pathFolders = allFolders.filter((f) => f && f.path && f.path.includes('[REBUILD]'));

  return nameFolders;
}


async function findEmptyFolders()
{
  speak('Looking for empty folders to delete');

  const allFolders = await messenger.folders.query();
  const foundFolders = allFolders.filter((f) => f && f.path);
  console.log('findEmptyFolders: count', foundFolders.length);
  return [];
//  return foundFolders;
}


// --------------------
// Create folders
// --------------------
// Relevant APIs:
//   https://webextension-api.thunderbird.net/en/mv3/folders.html#
//   https://webextension-api.thunderbird.net/en/mv3/messages.html
// --------------------

async function renderMessageDomain(Message) {
  if (!Message) {
    console.log('renderMessageDomain: no message provided');
    return null;
  }
  const author = Message.author || Message.from || '';
  // try to extract the email address
  const angleMatch = author.match(/<([^>]+)>/);
  const email = angleMatch ? angleMatch[1] : (author.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/) || [null])[0];
  if (!email) {
    console.log('renderMessageDomain: no email parsed from author', author);
    return null;
  }

  let domain = email.replace('@', '.@.');
  let splits = domain.split('.');
  splits.reverse();
  let finalDomain = splits.join('.').toLowerCase();
  finalDomain = finalDomain.replace('.@.', ' @ ');
  // use the domain (e.g., gmail.com) as folder partial name
  console.log('renderMessageDomain: extracted domain', finalDomain);
  return finalDomain;
}


async function getSingleEmailAddress(Message) {

  const emailAddress = await messenger.messengerUtilities.parseMailboxString(Message.author).then(function(ParsedMailboxList) {
    return ParsedMailboxList[0];
  });

  let emailParts = emailAddress.email.split('@');
  let tmpDomain = emailParts[1].toLowerCase();
  let splits = tmpDomain.split('.');
  splits.reverse();

  emailAddress.email_user = emailParts[0];
  emailAddress.email_domain = emailParts[1];
  emailAddress.email_domain_sortable = splits.join('.');

  if (tmpDomain == 'gmail.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'yahoo.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'wordpress.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'live.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'hotmail.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'substack.com')
      emailAddress.multi_tenant_domain = true;
  else
      emailAddress.multi_tenant_domain = false;

//  console.log(emailAddress);

  return emailAddress;
}


async function renderMessageFolderNamesImproved(Message)
{
  const domainFolder = await renderMessageDomain(Message);
  const emailAddress = await getSingleEmailAddress(Message);
  const userFolder = emailAddress.name + ' ' + Message.date.getFullYear();
  return domainFolder + '/' + userFolder;
}


async function renderMessageFolderNames(Message)
{
  const emailAddress = await getSingleEmailAddress(Message);
  const domainFolder = emailAddress.email_domain_sortable;
  const userFolder = Message.date.getFullYear() + ' ' + emailAddress.email_user + ' (' + emailAddress.name + ')';
  return domainFolder + '/' + userFolder;
}


async function pickActualFolderName(Message)
{
  const partialFolderName = await renderMessageFolderNames(Message);
  const domainFolder = getParentFolderPath(partialFolderName);
  const topFolder = getTopLevelFolder(Message.folder.path);
  const accountId = Message.folder.accountId;
  const folders = await messenger.folders.query();
  const existing = folders.find((f) => f && f.name == domainFolder);

  console.log('looking for ' + partialFolderName, 'accountId', accountId);

  if (topFolder.startsWith('/PRIORITY-')) {
    console.log('pickActualFolderName: found PRIORITY folder');
    fallbackFolderName = topFolder + '/' + partialFolderName;
  }
  else if (existing) {
    console.log('pickActualFolderName: found existing folder', existing);
    fallbackFolderName = getParentFolderPath(existing.path) + '/' + partialFolderName;
  }
  else {
  // @todo do not create a folder for a single email in the INBOX, put in staging folder first
    fallbackFolderName = '/PYTHON-SORT/' + partialFolderName;
    return null;
  }

  // create a new folder with the partial name
  const createdId = await create_and_return_folder(fallbackFolderName, accountId);
  return createdId;
}


function withTimeout(firstPromise, ms, message) {
  return firstPromise;

  return Promise.race([
    firstPromise,
    new Promise (
      (_, reject) => setTimeout (
        () => reject(
          new Error(message)
        ), 
        ms
      )
    ),
  ]);
}


function getParentFolderPath(fullFolderName) {
  return fullFolderName.substring(0, fullFolderName.lastIndexOf('/'));
}


function getTopLevelFolder(fullFolderName) {
  if (getFolderDepth(fullFolderName) > 1) {
    return getTopLevelFolder(getParentFolderPath(fullFolderName));
  }
  else {
    console.log('getTopLevelFolder:', fullFolderName);
    return fullFolderName;    
  }
}


function getFolderDepth(fullFolderName) {
  let depth = fullFolderName.split('/').length - 1;
  console.log('getFolderDepth: fullFolderName', fullFolderName, 'depth', depth);
  return depth;
}


async function delete_folder(fullFolderName) {
  console.log('delete_folder: Not implemented', fullFolderName);

  return null;
}


async function install_folders()
{
  await create_and_return_folder('AUTO-SORT/PURGE');
}


async function create_and_return_folder(fullFolderName, accountId = null) {

  if (!fullFolderName) {
    console.warn('create_and_return_folder: fullFolderName required');
    return null;
  }

  const folderId = await getFolderIdByName(fullFolderName);

  if (folderId) {
    return folderId;
  }

  const parentFolderName = await getParentFolderPath(fullFolderName);
  const partial = fullFolderName.substring(fullFolderName.lastIndexOf('/') + 1);

  // prefer to create under the source account first
  console.log('create_and_return_folder: recursive call to create parent');
  const parentId = await create_and_return_folder(parentFolderName, accountId);

  if (!parentId) {
    console.warn('create_and_return_folder: parentId not found');
    return null;
  }

  // speak('Folder creation is disabled');
  // return null;

  const created = await withTimeout(
    messenger.folders.create(parentId, partial),
    10000,
    `create_and_return_folder: messenger.folders.create timed out after 10000ms for folder ${partial}`
  );
  console.log('create_and_return_folder: created result', created);
  return (created) ? created.id : created;
}


// --------------------
// Move things
// --------------------
// Relevant APIs:
//   https://webextension-api.thunderbird.net/en/mv3/folders.html
//   https://webextension-api.thunderbird.net/en/mv3/messages.html
// --------------------

async function cleanupFolder(mailboxName) {
  speak('Cleaning up ' + mailboxName + ' folder');

  const messageList = await getMessagesInFolder(mailboxName);

  let count = 1;
  for (const message of messageList.messages) {
    console.log('Email', count, 'of', messageList.messages.length);
    await moveSingleMessage(message);
    count++;
  }
}


async function getMessagesInFolder(folderName) {
  const inboxId = await getFolderIdByName(folderName);
  const messageList = await messenger.messages.list(inboxId);

  return messageList;
}


async function moveSingleMessage(movingMessage)
{
  const newfolderId = await pickActualFolderName(movingMessage);

  if (!newfolderId) {
    return null;
  }

  const ids = [movingMessage.id].filter(Boolean);
  let result;

  result = await withTimeout(
    messenger.messages.move(ids, newfolderId, { isUserAction: true }),
    10000,
    `moveSingleMessage: messenger.messages.move timed out after 10000ms for folder ${newfolderId}`
  );

  console.log('moveSingleMessage: move result', result, 'ids', ids, 'destination', newfolderId);
  return result;
}


async function bulkMoveMessages(MessageList, staticFolder) {
  // normalize to an array of message objects
  const messagesArray = MessageList.messages || [];
  const ids = messagesArray.map((m) => m.id).filter(Boolean);
  if (!ids.length) {
    console.log('bulkMoveMessages: no message ids found');
    return null;
  }

  const newfolderId = await getFolderIdByName(staticFolder);

  console.log('bulkMoveMessages: moving', ids, 'to static folder', staticFolder);
  const staticResult = await messenger.messages.move(ids, newfolderId);
  console.log('bulkMoveMessages: static move result', staticResult);
  return staticResult;
}



// --------------------
// Announce things
// --------------------

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
  betterText = betterText.replace('-', ' ');
  console.log('SPEAK: ' + betterText);

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

  // @todo announce the amount of emails if more than one

  console.log('announceMessages: messageList', messageList);

  for await (const message of iterateMessagePages(messageList)) {
    const emailAddress = await getSingleEmailAddress(message);
    const sender = emailAddress.name;
    await speak(`You've got mail from ${sender}`);

    if (message.subject) {
      await speak(`Date.`);
      await speak(message.date.toString());
      await speak(`Subject.`);
      await speak(message.subject);
    }

    break; 
  }
}


// --------------------
// Listeners
// --------------------

messenger.messages.onNewMailReceived.addListener((_folder, messageList) => {
  console.log('onNewMailReceived fired', _folder, messageList);
  announceMessages(messageList).catch((error) => {
    console.error("You've Got Mail (onNewMailReceived):", error);
  });
});



messenger.idle.onStateChanged.addListener(async (IdleState) => {

//  speak('Idle state is now ' + IdleState);

  if (IdleState == 'idle') {
 //   runningIdle();
  }

});


async function runningIdle() {

//  await install_folders();

  const specialFolders = await findSpecialFolders();

  if (Array.isArray(specialFolders)) {
    for (const folder of specialFolders) {
      cleanupFolder(folder.path);
    }
  }


  const purgableFolders = await findRebuildableFolders();

  if (Array.isArray(purgableFolders)) {
    for (const folder of purgableFolders) {

      let allMessages = await getMessagesInFolder(folder.path);
      await bulkMoveMessages(allMessages, 'INBOX');
    }
  }

  const emptyFolders = await findEmptyFolders();

  if (Array.isArray(emptyFolders)) {
    for (const folder of emptyFolders) {
      await delete_folder(folder.path);
    }
  }
  

  await cleanupFolder('INBOX');
}


// --------------------
// Test Listeners
// --------------------

messenger.messageDisplay.onMessagesDisplayed.addListener((_tab, messageList) => {

  if (messageList.messages[0].folder.name == 'ANNOUNCE') {
    speak('Test announcement');
    announceMessages(messageList);
  }

});


messenger.folders.onUpdated.addListener((originalFolder, updatedFolder) => {

  if (updatedFolder.name == 'IDLE') {
    speak('Test folder updated');
    runningIdle();
  }

});

