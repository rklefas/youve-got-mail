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


async function findSpecialFolders(accountId)
{
  const allFolders = await messenger.folders.query();
  // prefer exact or exact-prefix match, PRIORITY folders
  const foundFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    f.path.startsWith('/PRIORITY-') && 
    f.name.startsWith('PRIORITY-')
  );

  if (foundFolders.length == 0) {
//    await install_folders();
  }

  return foundFolders;
}


async function findRebuildableFolders(accountId)
{
  const allFolders = await messenger.folders.query({
    hasMessages: true
  });
  
  const nameFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    f.name && 
    f.name.includes('[REBUILD]')
  );

  if (nameFolders.length == 0) {
    const pathFolders = allFolders.filter((f) => f && 
      f.accountId === accountId &&  
      f.path && f.path.includes('[REBUILD]')
    );
    return pathFolders;
  }
  else {
    return nameFolders;
  }
}


async function findEmptyFolders(accountId)
{
  if (allowFolderCreation() == false) {
    return [];
  }

  const allFolders = await messenger.folders.query({
    hasMessages: false,
    hasSubFolders: false,
    isRoot: false
  });

  let nameFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    f.path.includes('[REBUILD]')
  );

  if (nameFolders.length) {
    return nameFolders;
  }

  nameFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    f.path.startsWith('/PRIORITY')
  );

  return nameFolders;
}


async function findFolderIdWithPath(accountId, mailboxName) {

  if (!mailboxName) {
    throw new Error('mailboxName required');
  }

  console.log('findFolderIdWithPath: looking for', mailboxName);

  const allFolders = await messenger.folders.query();
  const targetName = mailboxName.toUpperCase();
  const folders = allFolders.filter((f) => 
    f.accountId === accountId &&
    f.path.toUpperCase() === targetName
  );

  if (folders.length > 1) {
    console.log(folders);
    throw new Error('Folder name is ambiguous');
  }

  const folder = folders[0];
  if (!folder) {
    console.log('findFolderIdWithPath: not found', mailboxName);
    return null;
  }
  else {
    console.log('findFolderIdWithPath: ', folder);
  }

  return folder.id;
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
  const existing = folders.find((f) => f.accountId == accountId && f.name == domainFolder);
  let fallbackFolderName = null;
  
  console.log('looking for ' + partialFolderName, 'accountId', accountId);

  if (topFolder.startsWith('/PRIORITY-')) {
    // Create a subfolder under the PRIORITY folder if it exists
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

  if (fallbackFolderName.includes('[REBUILD]')) {
    console.log('pickActualFolderName: cancelling folder creation');
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
  const depth = fullFolderName.trim('/').split('/').length - 1;
  console.log('getFolderDepth: fullFolderName', fullFolderName, 'depth', depth);
  return depth;
}


async function delete_folder(folderObject)
{
  if (allowFolderCreation() == false) {
    speak('Folder deletion is disabled');
    return null;
  }

  const fullFolderName = folderObject.path;

  if (getFolderDepth(fullFolderName) > 1)
  {
    const folderInfo = await messenger.folders.getFolderInfo(folderObject.id);

    if (folderInfo.totalMessageCount == 0) {
      console.log('delete_folder:', fullFolderName);
      await messenger.folders.delete(folderObject.id);
    }
  }
  else {
    console.log('delete_folder: skipping', fullFolderName);
  }

  return null;
}


async function install_folders()
{
  await create_and_return_folder('AUTO-SORT/PURGE');
}


async function create_and_return_folder(fullFolderName, accountId) {

  if (!fullFolderName) {
    console.warn('create_and_return_folder: fullFolderName required');
    return null;
  }

  const folderId = await findFolderIdWithPath(accountId, fullFolderName);

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

  if (allowFolderCreation() == false) {
    speak('Folder creation is disabled');
    return null;
  }

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

async function cleanupFolder(accountId, mailboxName) {
  const messageList = await getMessagesInFolder(accountId, mailboxName, getEmailFetchLimit());

  speakMessageWithCounts(
    'Moving # email(s) in ' + mailboxName + ' folder', 
    messageList.messages.length
  );

  let count = 1;
  for (const message of messageList.messages) {
    console.log('Moving Email', count, 'of', messageList.messages.length);
    await moveSingleMessage(message);
    count++;
  }

  return count;
}


async function getMessagesInFolder(accountId, folderName, limit = null) {
  const inboxId = await findFolderIdWithPath(accountId, folderName);

  // @todo These will work for v148 and later
  const listSortOptions = {
    sortOrder: 'descending',
    sortType: 'date'
  };

  const messageList = await messenger.messages.list(inboxId);

  if (limit > 0) {
    messageList.messages = messageList.messages.slice(0, limit);
  }

  return messageList;
}


async function moveSingleMessage(movingMessage)
{
  const newfolderId = await pickActualFolderName(movingMessage);

  if (!newfolderId) {
    throw new Error('Could not pick actual folder');
  }

  const ids = [movingMessage.id].filter(Boolean);
  let result;

  if (allowMessageMovement() == false) {
    console.log('Single message movement is disabled');
    return null;
  }

  result = await withTimeout(
    messenger.messages.move(ids, newfolderId),
    10000,
    `moveSingleMessage: messenger.messages.move timed out after 10000ms for folder ${newfolderId}`
  );

  console.log('moveSingleMessage: move result', result, 'ids', ids, 'destination', newfolderId);
  return result;
}


async function bulkMoveMessages(accountId, MessageList, staticFolder) {
  // normalize to an array of message objects
  const messagesArray = MessageList.messages || [];
  const ids = messagesArray.map((m) => m.id).filter(Boolean);
  if (!ids.length) {
    console.log('bulkMoveMessages: no message ids found');
    return null;
  }

  const newfolderId = await findFolderIdWithPath(accountId, staticFolder);

  if (allowMessageMovement() == false) {
    speak('Message movement is disabled');
    return null;
  }

  console.log('bulkMoveMessages: moving', ids, 'to static folder', staticFolder);
  const staticResult = await messenger.messages.move(ids, newfolderId);
  console.log('bulkMoveMessages: static move result', staticResult);
  return staticResult;
}


// --------------------
// Semantic Analysis
// --------------------

async function is_newsletter(Message) {

  // https://webextension-api.thunderbird.net/en/mv3/messages.html#messages-headers-dictionary

  const fullObject = await messenger.messages.getFull(Message.id);
  const headers = fullObject.headers;
  let newsletterHeaders = 0;

  if (Object.hasOwn(headers, 'list-unsubscribe')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'list-unsubscribe-post')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'list-subscribe')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'list-id')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'x-campaignid')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'precedence')) {
    if (headers.precedence == 'bulk')
      newsletterHeaders++;
    else if (headers.precedence == 'list')
      newsletterHeaders++;
  }
  else {
    // @todo we can check for more headers or the email content itself
    console.log(headers);
  }

  if (newsletterHeaders > 0)
    return true;

  return false;
}




// --------------------
// Announce things
// --------------------

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

  let betterText = text.trim();
  betterText = betterText.replace(' | ', '; ');
  betterText = betterText.replace('-', ' ');
  console.log('SPEAK: ' + betterText);

  // @todo lower system volume first
  // https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API

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

  for (const message of messageList.messages) {

    if (message.date.toDateString() != new Date().toDateString()) {
      continue;
    }

    const emailAddress = await getSingleEmailAddress(message);
    const sender = emailAddress.name;

    if (await is_newsletter(message)) {
      await speak(`You've got a newsletter from ${sender}`);
    }
    else {
      await speak(`You've got mail from ${sender}`);
    }

    if (message.subject) {
      await speak(`Subject: ` + message.subject);
    }

    break; 
  }
}


function speakMessageWithCounts(verbiage, count) {
  const withNumber = verbiage.replace('#', count);
  let finalMessage = withNumber;
  if (count == 1) {
    finalMessage = withNumber.replace('(s)', '');
  }
  else {
    finalMessage = withNumber.replace('(s)', 's');
  }

  if (count > 0) {
    speak(finalMessage)
  }
  else {
    console.log(finalMessage)
  }
}



// --------------------
// Permissions
// --------------------

function getEmailFetchLimit() {
  return 10;
}


function allowFolderCreation() {
  return false;
}

function allowMessageMovement() {
  return false;
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

  const browser = await messenger.runtime.getBrowserInfo();
  speak(browser.name + ' is in ' + IdleState + ' state');

  if (IdleState == 'idle') {

    const periodMinutes = 20;
    const nowMinutes = new Date().getMinutes();
    const reducedNowMinutes = (nowMinutes > periodMinutes) ? nowMinutes % periodMinutes : nowMinutes;
    const delayMinutes = periodMinutes - reducedNowMinutes;

    speak(`Setting alarm to trigger every ${periodMinutes} minutes, starting in ${delayMinutes} minutes.`);
    
    messenger.alarms.create('idle-alarm', {
      delayInMinutes: delayMinutes,
      periodInMinutes: periodMinutes
    });
  }
  else {
    messenger.alarms.clear('idle-alarm');
  }

});


async function runningIdle(accountId) {

  console.log('runningIdle for account', accountId);

  const specialFolders = await findSpecialFolders(accountId);

  for (const folder of specialFolders) {
    await cleanupFolder(accountId, folder.path);
  }


  const purgableFolders = await findRebuildableFolders(accountId);
  speakMessageWithCounts('Found # folder(s) marked to rebuild', purgableFolders.length);

  for (const folder of purgableFolders) {
    let allMessages = await getMessagesInFolder(accountId, folder.path, getEmailFetchLimit());
    await bulkMoveMessages(accountId, allMessages, '/INBOX');
    await delete_folder(folder);
    break;
  }


  const emptyFolders = await findEmptyFolders(accountId);
  speakMessageWithCounts('Found # empty folder(s) to delete', emptyFolders.length);

  for (const folder of emptyFolders) {
    await delete_folder(folder);
  }


  await cleanupFolder(accountId, '/INBOX');
}


messenger.alarms.onAlarm.addListener((alarmObject) => {

  const currentTime = new Date().toLocaleTimeString()
  const shorterTime = currentTime.replace(/:\d{2}\s/, ' '); // Remove seconds from the time string
  speak('The time is now ' + shorterTime);
  speak('Triggering: ' + alarmObject.name);

  if (alarmObject.name == 'idle-alarm') {
    runningIdle();
  }

});


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
    console.log(updatedFolder);
    runningIdle(updatedFolder.accountId);
  }

});

