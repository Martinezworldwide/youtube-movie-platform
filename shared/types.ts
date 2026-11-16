export interface Movie {
  id: number;
  youtubeId: string;
  title: string;
  year: number;
  genre: string;
  category: string;
  description: string;
  duration: string; // human-readable, e.g. "1h 36m"
  durationSeconds: number;
  rating: string; // e.g. "NR", "Passed"
  thumbnailUrl: string;
  channelTitle?: string;
}

export type NewMovie = Omit<Movie, "id" | "thumbnailUrl"> & { thumbnailUrl?: string };

export interface WatchlistItem { userId: string; movieId: number; addedAt: string; }
export interface HistoryItem {
  userId: string; movieId: number; progressSeconds: number;
  watchedAt: string; updatedAt: string;
}
export const CATEGORIES: Record<string, string> = {
  "free-with-ads": "Free with Ads — YouTube Movies & TV",
  "featured": "Featured",
  "action": "Action",
  "horror-central": "Horror Central",
  "comedy-collection": "Comedy Collection",
  "drama": "Drama",
  "sci-fi": "Sci-Fi",
  "thriller": "Thriller",
  "public-domain-classics": "Public Domain Classics",
};
