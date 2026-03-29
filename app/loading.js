// Loading silențios — fără spinner vizibil între navigări
// Prefetch-ul din SwipeNavigator face paginile disponibile instant
export default function Loading() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#07090e',
      zIndex: 999,
    }} />
  );
}

