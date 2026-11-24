import { useEffect, useRef } from 'react';
import { createParticleField } from './particleEngine';

/** Background artwork. The shapes change on their own; only pausing is controlled from outside. */
export default function ParticleField({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ReturnType<typeof createParticleField> | null>(null);
  useEffect(() => {
    engine.current = createParticleField(canvas.current!);
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);
  useEffect(() => { engine.current?.setPaused(paused); }, [paused]);
  return <canvas className="qy-particle-field" ref={canvas} aria-hidden="true" />;
}
