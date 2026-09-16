let latestProjectSwitch = 0;

export function beginProjectSwitch() {
  latestProjectSwitch += 1;
  return latestProjectSwitch;
}

export function isCurrentProjectSwitch(switchId: number) {
  return switchId === latestProjectSwitch;
}
