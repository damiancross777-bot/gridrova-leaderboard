import { randomInt } from "node:crypto";
import { LIMITS } from "./config.js";

// Generated public aliases only. Players never type a name, so there is nothing to moderate
// and no personal information can reach the public board.
const ADJECTIVES = [
  "Curious", "Bright", "Swift", "Quiet", "Clever", "Brave", "Calm", "Lucky", "Merry", "Nimble",
  "Bold", "Gentle", "Keen", "Jolly", "Sunny", "Steady", "Witty", "Eager", "Plucky", "Breezy",
  "Cosy", "Daring", "Golden", "Hidden", "Misty", "Noble", "Rapid", "Silver", "Tidy", "Wandering",
];
const ANIMALS = [
  "Otter", "Falcon", "Wombat", "Koala", "Heron", "Badger", "Lynx", "Puffin", "Gecko", "Robin",
  "Marten", "Quokka", "Ibis", "Panda", "Fox", "Wren", "Echidna", "Seal", "Owl", "Hare",
  "Kestrel", "Dingo", "Emu", "Magpie", "Turtle", "Bison", "Crane", "Lark", "Moose", "Yak",
];

export function generateAlias(): string {
  const name = `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${ANIMALS[randomInt(ANIMALS.length)]} ${randomInt(10, 100)}`;
  return name.slice(0, LIMITS.displayNameMax);
}

/** Defensive check applied to anything placed in a public response. */
export function safeDisplayName(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9 ]{1,24}$/.test(value) ? value : "Player";
}
