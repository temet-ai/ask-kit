export interface Patrol {
  walk(street: string): void;
  readonly beat: number;
}

export class NightWatch implements Patrol {
  beat = 3;
  walk(street: string): void {
    console.log(street);
  }
}

export class DayWatch implements Patrol {
  beat = 1;
  walk(street: string): void {}
}
