import { useEffect, useRef, useState } from 'react';

// Face layout: front 1, top 2, right 3, left 4, bottom 5, back 6.
const FACE_ROT: Record<number, [number, number]> = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180],
};

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

function Face({ n, cls }: { n: number; cls: string }) {
  return (
    <div className={`die-face ${cls}`}>
      {PIPS[n].map(([x, y], i) => (
        <span key={i} className="pip" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  );
}

/** A tumbling 3D die that always lands on the engine's value. */
export function Die({ value, rollId, index, reduced }: { value: number; rollId: number; index: number; reduced: boolean }) {
  const spins = useRef(0);
  const [rot, setRot] = useState<[number, number]>(FACE_ROT[value]);
  const lastRoll = useRef(rollId);
  useEffect(() => {
    const [x, y] = FACE_ROT[value];
    if (rollId !== lastRoll.current && !reduced) {
      spins.current += 2 + index;
      lastRoll.current = rollId;
      setRot([x + 360 * spins.current, y + 360 * (spins.current - 1)]);
    } else {
      const base = 360 * spins.current;
      setRot([x + base, y + (spins.current ? 360 * (spins.current - 1) : 0)]);
    }
  }, [value, rollId, index, reduced]);
  return (
    <div className="die" aria-hidden="true">
      <div className="die-cube" style={{ transform: `rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)`, transitionDuration: reduced ? '0s' : '0.85s' }}>
        <Face n={1} cls="f-front" />
        <Face n={6} cls="f-back" />
        <Face n={3} cls="f-right" />
        <Face n={4} cls="f-left" />
        <Face n={2} cls="f-top" />
        <Face n={5} cls="f-bottom" />
      </div>
    </div>
  );
}
