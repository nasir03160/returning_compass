import React from 'react';
import { Beacon } from './Beacon';
import { beaconState } from '../world/beaconState';

/** The 5 fixed objective towers. */
export function Beacons() {
  return (
    <>
      {beaconState.beacons.map((b) => (
        <Beacon key={b.id} id={b.id} />
      ))}
    </>
  );
}
