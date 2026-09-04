export const motion = {
  duration: { instant: 0, fast: 120, normal: 200, slow: 320 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    enter: 'cubic-bezier(0, 0, 0, 1)',
    exit: 'cubic-bezier(0.3, 0, 1, 1)',
  },
  press: { scale: 0.98, opacity: 0.88 },
} as const;
