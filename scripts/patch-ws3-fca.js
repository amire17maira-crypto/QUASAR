"use strict";

const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "node_modules/ws3-fca/src/deltas/apis/mqtt/deltas/value.js"
);

if (!fs.existsSync(target)) {
  console.error("[ws3-fca patch] Target file not found.");
  process.exit(1);
}

let source = fs.readFileSync(target, "utf8");

const marker = "} else if (delta.deltaMessageReply) {";
const markerIndex = source.indexOf(marker);

if (markerIndex === -1 || source.indexOf(marker, markerIndex + marker.length) !== -1) {
  console.error("[ws3-fca patch] Unexpected deltaMessageReply structure.");
  process.exit(1);
}

const callbackIndex = source.indexOf("var callbackToReturn = {", markerIndex);

if (callbackIndex === -1) {
  console.error("[ws3-fca patch] callbackToReturn not found.");
  process.exit(1);
}

const threadIndex = source.indexOf("threadID:", callbackIndex);

if (threadIndex === -1 || threadIndex - callbackIndex > 500) {
  console.error("[ws3-fca patch] Unexpected callback structure.");
  process.exit(1);
}

const header = source.slice(callbackIndex, threadIndex);
const oldType = 'type: "message_reply",';
const newType = 'type: "message",';

if (header.includes(newType) && !header.includes(oldType)) {
  console.log("[ws3-fca patch] Already applied.");
  process.exit(0);
}

if (header.split(oldType).length !== 2 || header.includes(newType)) {
  console.error("[ws3-fca patch] Unexpected message type; refusing to modify.");
  process.exit(1);
}

const patchedHeader = header.replace(oldType, newType);
source = source.slice(0, callbackIndex) +
  patchedHeader +
  source.slice(threadIndex);

fs.writeFileSync(target, source);
console.log("[ws3-fca patch] Applied successfully.");
