import { useEffect, useRef } from 'react';
import { createParticleField, type ParticleScene } from './particleEngine';

export default function ParticleField({ scene, paused }: { scene: ParticleScene; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ReturnType<typeof createParticleField> | null>(null);
  useEffect(() => {
    engine.current = createParticleField(canvas.current!);
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);
  useEffect(() => { engine.current?.setScene(scene); }, [scene]);
  useEffect(() => { engine.current?.setPaused(paused); }, [paused]);
  return <canvas className="qy-particle-field" ref={canvas} aria-hidden="true" />;
}
