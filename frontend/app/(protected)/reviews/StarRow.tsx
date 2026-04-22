import styles from "./reviews.module.css";

export default function StarRow({ rating, outOf = 5 }: { rating: number; outOf?: number }) {
  const r = Math.max(0, Math.min(outOf, Math.round(rating)));
  return (
    <span className={styles.stars} aria-label={`${r} out of ${outOf} stars`}>
      {Array.from({ length: outOf }).map((_, i) => (
        <span key={i} className={i < r ? styles.starFilled : styles.starEmpty}>
          ★
        </span>
      ))}
    </span>
  );
}
