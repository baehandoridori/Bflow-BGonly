import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const COLORS = ['#00B894', '#A29BFE', '#FDCB6E', '#74B9FF', '#FF6B6B', '#6C5CE7'];
const COUNT = 20;

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  rot: number;
  scale: number;
  round: boolean;
}

interface ConfettiProps {
  active: boolean;
  onComplete?: () => void;
}

export function Confetti({ active, onComplete }: ConfettiProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  const stableComplete = useCallback(() => onComplete?.(), [onComplete]);

  useEffect(() => {
    if (!active) return;

    setParticles(
      Array.from({ length: COUNT }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 180,
        y: -(Math.random() * 120 + 40),
        color: COLORS[i % COLORS.length],
        rot: Math.random() * 540 - 270,
        scale: Math.random() * 0.6 + 0.4,
        round: Math.random() > 0.5,
      }))
    );

    const t = setTimeout(() => {
      setParticles([]);
      stableComplete();
    }, 1400);
    return () => clearTimeout(t);
  }, [active, stableComplete]);

  return (
    <AnimatePresence>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: p.scale, rotate: p.rot }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="absolute pointer-events-none z-50"
          style={{
            width: p.round ? 7 : 9,
            height: p.round ? 7 : 5,
            borderRadius: p.round ? '50%' : '1px',
            backgroundColor: p.color,
            left: '50%',
            top: '50%',
          }}
        />
      ))}
    </AnimatePresence>
  );
}
