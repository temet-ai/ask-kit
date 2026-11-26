// The Night Watch: who patrols, and who relieves them.
import { Guild } from "./guild.mjs";

export const SHIFT_HOURS = 8;

export function relieve(post) {
  return `${post} relieved after ${SHIFT_HOURS} hours`;
}

export class Watch extends Guild {
  officers = [];

  constructor(name) {
    super(name);
    this.name = name;
  }

  async patrol(street, o = {}) {
    // A regular expression with a quote in it must not hide the call after it.
    const quote = /'/;
    ringBell(quote);
    const note = `walked ${street}, then ${relieve(street)}`;
    this.officers.push(street);
    return note;
  }
}

export function ringBell(why) {
  return `bell: ${why}`;
}

export function nightShift(watch) {
  return watch.patrol("Treacle Mine Road");
}
