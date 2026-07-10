export default function PlaygroundView() {
  return (
    <section className="min-h-full bg-bg-primary p-8 text-text-primary" aria-labelledby="playground-title">
      <h1 id="playground-title" tabIndex={-1} className="text-3xl font-semibold outline-none">
        배플레이그라운드
      </h1>
      <p className="mt-3 text-sm text-text-secondary">지금은 쉬는 시간!</p>
    </section>
  );
}
