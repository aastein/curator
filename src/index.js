'use strict';

require('babelify-es6-polyfill');
const fs = require('fs');
const request = require('request');
const schedule = require('node-schedule');
const instagram = require('instagram-private-api');
const MongoClient = require('mongodb').MongoClient
const assert = require('assert');
const dbUrl = 'mongodb://localhost:27017/curator';

var Client = instagram.V1;
var storage;
var device;
var config;
var username;
var password;
var storagePath;
var threadName;
var session;
var inboxFeed;
var thread;
var threadFeed;
var newImagePosts = [];
var newVideoPosts = [];
var postedUrls;
var unpostedImagePosts;
var unpostedVideoPosts;

// Read credentials from the database and set credential variables
function setCredentials(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Setting credentials");
      var col = db.collection('credentials');
      var data = col.find({}).toArray((err, data) => {
        username = data[0].username;
        password = data[0].password;
        console.log("Set credentials");
        db.close();
        console.log("Disconnected from db");
        resolve();
      });
    });
  });
}

// Set the storeage path from the value specified the config object
function setStoragePath(){
  storagePath = config.filter((record) => {
    return record.storage != null;
  });
  console.log("Set storage path to:", storagePath);
}

// Set the name of the group chat or message thread specifiedin the config object
function setThreadName(){
  threadName = config.find((record) => {
    return record.threadName != null;
  }).threadName.replace(/\s/g, " ");
  console.log("Set threadName to:", threadName);
}

// Reads the config from the database sets the config object
function setConfig(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Setting config");
      var col = db.collection('config');
      var data = col.find({}).toArray((err, data) => {
        config = data;
        db.close();
        console.log("Disconnected from db");
        resolve();
      });
    });
  });
}

// Sets up the credentials and configurations
function setup(){
  return new Promise((resolve, reject) => {
      setConfig().then(() => {
        setStoragePath();
        setThreadName();
      }).then(setCredentials().then(() => {
        resolve();
      }));
  });
}

// Sets the instagram session. This is eqivalent to logging in
function setSession(){
  return new Promise((resolve, reject) => {
    console.log("Setting session");
    device = new Client.Device(username);
    storage = new Client.CookieFileStorage(storagePath + username + '.json');
    Client.Session.create(device, storage, username, password).then((s) => {
     		session=s;
        console.log("Set session");
        resolve(true);
  	});
  });
}

// Sets the inboxFeed. The inboxFeed is the users inbox.
function setInboxFeed(){
  return new Promise((resolve, reject) => {
    console.log("Setting inbox feed")
    new Client.Feed.Inbox(session, 100).get().then((feed) => {
      inboxFeed = feed;
      console.log("Set inbox feed");
      resolve();
    });
  });
}

// Finds the correct thread in the inboxFeed. This is eqivalent to finding the
// group chat or message thread by the title of the group chat or message thread
// in the users inbox.
function setThreadWithName(){
  console.log("Setting thread by name:", threadName);
  thread = inboxFeed.find((thread) => {
      return thread._params.title === threadName;
  });
  console.log("Set thread");
}

// Gets the threadItems feed from the thread. This is equivalent to getting the
// messages in the group chat or message thread.
function setThreadItemFeed(){
  return new Promise((resolve, reject) => {
    console.log("Setting thread items feed from feed");
    new Client.Feed.ThreadItems(session, thread.id, 100).get().then((feed) => {
      threadFeed = feed;
      console.log("Set thread items feed");
      resolve();
    });
  });
}

// Gets only messages in the thread which are shared images.
// Each imagePost has a url of the image and the username of the original poster
function getNewPosts(){
  console.log("Setting new image posts");
  var index = 0;

  newImagePosts = threadFeed.map((item) => {
    // Index the messages in the feed
    item.curatorIndex = index;
    index ++;
    return item;
  }).filter((item) => {
    return item.getParams().mediaShare != null;
  }).filter((item) => {
    return item.getParams().mediaShare.mediaType == 1;
  }).filter((item) => {
    return item.getParams().mediaShare.images[0] != null;
  }).filter((item) => {
    return item.getParams().mediaShare.images[0].url != null;
  }).map((item) => {
    var imagePost = {};
    imagePost.imageUrl = item.getParams().mediaShare.images[0].url;
    imagePost.sourceName = item.getParams().mediaShare.account.username;
    imagePost.index = item.curatorIndex;
    imagePost.imageExtension = '.jpg'
    imagePost.filePath = 'temp/a' + Math.ceil(Math.random()*new Date().getTime());
    imagePost.comment = '';
    return imagePost;
  });

  console.log("Got new image posts");

  newVideoPosts = threadFeed.filter((item) => {
    return item.getParams().mediaShare != null;
  }).filter((item) => {
    return item.getParams().mediaShare.mediaType == 2;
  }).filter((item) => {
    return item.getParams().mediaShare.videos[0] != null;
  }).filter((item) => {
    return item.getParams().mediaShare.videos[0].url != null;
  }).map((item) => {
    var videoPost = {};
    videoPost.videoUrl = item.getParams().mediaShare.videos[0].url;
    videoPost.imageUrl = item.getParams().mediaShare.images[0].url;
    videoPost.videoExtension = '.mp4';
    videoPost.imageExtension = '.jpg';
    videoPost.filePath = 'temp/a' + Math.ceil(Math.random()*new Date().getTime());
    videoPost.sourceName = item.getParams().mediaShare.account.username;
    videoPost.index = item.curatorIndex;
    videoPost.comment = '';
    return videoPost;
  });

  console.log("Got new video posts");

  // Add subsequent text message as imagePost comment
  newImagePosts = newImagePosts.map((imagePost) => {
    if(imagePost.index > 0 && threadFeed[imagePost.index - 1] != null){
      var nextPost = threadFeed[imagePost.index - 1];
      if(nextPost.getParams().type === 'text'){
        imagePost.comment = nextPost.getParams().text;
      }
    }
    return imagePost;
  });

  // Add subsequent text message as videoPost comment
  newVideoPosts = newVideoPosts.map((videoPost) => {
    if(videoPost.index > 0 && threadFeed[videoPost.index - 1] != null){
      var nextPost = threadFeed[videoPost.index - 1];
      if(nextPost.getParams().type === 'text'){
        videoPost.comment = nextPost.getParams().text;
      }
    }
    return videoPost;
  });

  console.log("Set new posts");
}

// Reads previously posted urls from the databse and stores the value in postedUrls
function getPostedUrls(){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Getting posted image urls");
      var col = db.collection('images');
      var data = col.find({}).toArray((err, data) => {
        postedUrls = data.map((d) => {
          return d.url;
        });
        db.close();
        console.log("Disconnected from db");
        resolve();
      });
    });
  });
}

// Filters the list of newImagePosts for posts which have urls that are not in
// the postedUrls object.
function getUnpostedPosts(){
  unpostedImagePosts = newImagePosts.filter((imagePost) => {
    console.log("Already posted:", postedUrls.includes(imagePost.url))
    return !postedUrls.includes(imagePost.imageUrl);
  });

  unpostedVideoPosts = newVideoPosts.filter((videoPost) => {
    console.log("Already posted:", postedUrls.includes(videoPost.videoUrl))
    return !postedUrls.includes(videoPost.videoUrl);
  });

  console.log("Set unposted image urls:", unpostedImagePosts);
  console.log("Set unposted video urls:", unpostedVideoPosts);
}

// Downloads an mediaPost by the mediaPost url and the file path of the mediaPost
// The file path is added to an mediaPost in downloadPosts() before invoking
// this method.
function downloadImage(imagePost){
  return new Promise((resolve, reject) => {
    var url = imagePost.imageUrl;
    var filePath = imagePost.filePath + imagePost.imageExtension;
    console.log("Downloading image by url:", url);
    request.head(url, function(err, res, body){
      request(url).pipe(fs.createWriteStream(filePath)).on('close', () => {
        console.log("Downloaded media");
        resolve();
      });
    });
  });
}

function downloadImagePosts(){
return new Promise((resolve, reject) => {
    if(unpostedImagePosts.length > 0){
      console.log("Downloading images");
    }
    // Download all unpostedImagePosts
    var promiseImages = unpostedImagePosts.map((imagePost) => {
      return downloadImage(imagePost);
    });
    Promise.all(promiseImages).then(() => {
      console.log("Downloaded images");
      resolve();
    });
  });
}

function downloadVideo(videoPost){
  return new Promise((resolve, reject) => {
    var url = videoPost.videoUrl;
    var filePath = videoPost.filePath + videoPost.videoExtension;
    console.log("Downloading video by url:", url);
    request.head(url, function(err, res, body){
      request(url).pipe(fs.createWriteStream(filePath)).on('close', () => {
        console.log("Downloaded media");
        resolve();
      });
    });
  });
}

function downloadVideoPosts(){
  return new Promise((resolve, reject) => {
    if(unpostedVideoPosts.length > 0){
      console.log("Downloading videos");
    }
    var promiseVideos = unpostedVideoPosts.map((videoPost) => {
      return downloadVideo(videoPost);
    });
    Promise.all(promiseVideos).then(() => {
      console.log("Downloaded videos");
      resolve();
    });
  });
}

function downloadVideoImages(){
  return new Promise((resolve, reject) => {
    if(unpostedVideoPosts.length > 0){
      console.log("Downloading video images");
    }
    var promiseVideoImages = unpostedVideoPosts.map((videoPost) => {
      return downloadImage(videoPost);
    });
    Promise.all(promiseVideoImages).then(() => {
      console.log("Downloaded videos");
      resolve();
    });
  });
}

// For each unpostedImagePost this method sets a download path for the imagePost
// then downloads the image specified by the imagePost
function downloadPosts(){
  return new Promise((resolve, reject) => {
    downloadImagePosts().then(() =>{
      downloadVideoPosts().then(() => {
        downloadVideoImages().then(() => {
          console.log("Completed all downloads");
          resolve();
        });
      });
    });
  });
}

// Posts the image specifed in the imagePost .The minimum comment is a tag of
// the original poster.
function postImage(imagePost){
  return new Promise((resolve, reject) => {
    var path = imagePost.filePath;
    var source = 'source: @' + imagePost.sourceName;
    var comment = imagePost.comment != '' ? imagePost.comment + ' ' + source : source;
    // Uploads and posts the image to Instagram
    new Client.Upload.photo(session, path).then((upload) => {
      console.log("Posting image:", path);
      return new Client.Media.configurePhoto(session, upload.params.uploadId, comment);
    })
    .then((medium) => {
      console.log("Posted image");
      resolve();
    });
  });
}

// Posts all images in the unpostedImagePosts
function postImages(){
  return new Promise((resolve, reject) => {
    // Post the images
    var promiseUploads = unpostedImagePosts.map((imagePost) => {
        return postImage(imagePost);
    });
    Promise.all(promiseUploads).then(() => {
      console.log("Completed posting images");
      resolve();
    });
  });
}

// Posts the image specifed in the videoPost .The minimum comment is a tag of
// the original poster.
function postVideo(videoPost){
  return new Promise((resolve, reject) => {
    var videoPath = videoPost.filePath + videoPost.videoExtension;
    console.log("Posting video:", videoPath);
    var imagePath = videoPost.filePath + videoPost.imageExtension;
    var source = 'source: @' + videoPost.sourceName;
    var comment = videoPost.comment != '' ? videoPost.comment + ' ' + source : source;
    // Uploads and posts the image to Instagram
    new Client.Upload.video(session, videoPath, imagePath).then(function(upload) {
      console.log("upload:", upload);
    	return new Client.Media.configureVideo(session, upload.uploadId, comment, upload.durationms);
    })
    .then(function(medium) {
      console.log("Posted video");
      resolve();
  	});
  });
}

// Posts all videos in the unpostedVideoPosts
function postVideos(){
  return new Promise((resolve, reject) => {
    // Post the videos
    console.log("Posting videos");
    var promiseUploads = unpostedVideoPosts.map((videoPost) => {
        return postVideo(videoPost);
    });
    Promise.all(promiseUploads).then(() => {
      console.log("Posted videos");
      resolve();
    });
  });
}

// Writes the url of a newly posted image to the database so that it will not
// be posted again.
function recordPostedUrl(url){
  return new Promise((resolve, reject) => {
    MongoClient.connect(dbUrl, (err, db) => {
      assert.equal(null, err);
      console.log("Connected successfully to db");
      console.log("Recording posted image url");
      var col = db.collection('images');
      col.insertOne({"url":url}, (err, r) => {
        assert.equal(null, err);
        assert.equal(1, r.insertedCount);
        console.log("Disconnected from db");
        db.close();
        resolve();
      });
    });
  });
}

// Writes the url of all newly posted images to the database so they will noy
// be posted again.
function recordPostedUrls(){
  return new Promise((resolve, reject) => {
    console.log("Recording posted image urls");
    var promiseInserts;

    var promiseInsertImageUrls = unpostedImagePosts.map((imagePost) => {
        return recordPostedUrl(imagePost.imageUrl);
    });

    var promiseInsertVideoUrls = unpostedVideoPosts.map((videoPost) => {
        return recordPostedUrl(videoPost.videoUrl);
    });

    Promise.all(promiseInserts).then(() => {
      console.log("Recorded posted image and video urls");
      resolve();
    });
  });
}

// Runs all the things
function main(){
  setup().then(() => {
    setSession().then(() => {
      setInboxFeed().then(() => {
        setThreadWithName();
        setThreadItemFeed().then(() => {
          getNewPosts();
          getPostedUrls().then(() => {
            getUnpostedPosts();
            downloadPosts().then(() => {
              postImages().then(() => {
                postVideos().then(() => {
                  recordPostedUrls().then(() => {
                    console.log("Done");
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

// Entry point
main();
