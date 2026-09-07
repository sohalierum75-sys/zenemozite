// Mock movie data structure - Ready for API integration
export const moviesData = [
  {
    id: 1,
    title: "Inception",
    year: 2010,
    rating: 8.8,
    genre: ["Action", "Sci-Fi", "Thriller"],
    duration: "148 min",
    poster: "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
    plot: "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O., but his tragic past may doom the project and his team to disaster.",
    cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page", "Tom Hardy"],
    director: "Christopher Nolan",
    language: "English",
    quality: ["720p", "1080p", "4K", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "4K": "https://example.com/download/4k",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/YoHD9XEInc0",
    featured: true
  },
  {
    id: 2,
    title: "The Dark Knight",
    year: 2008,
    rating: 9.0,
    genre: ["Action", "Crime", "Drama"],
    duration: "152 min",
    poster: "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/hkBaDkMWbLaf8B1lsWsKX7Ew3Xq.jpg",
    plot: "When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.",
    cast: ["Christian Bale", "Heath Ledger", "Aaron Eckhart", "Michael Caine"],
    director: "Christopher Nolan",
    language: "English",
    quality: ["720p", "1080p", "4K", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "4K": "https://example.com/download/4k",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/EXeTwQWrcwY",
    featured: false
  },
  {
    id: 3,
    title: "Interstellar",
    year: 2014,
    rating: 8.7,
    genre: ["Adventure", "Drama", "Sci-Fi"],
    duration: "169 min",
    poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/pbrkL804c8yAv3zBZR4QPEafpAR.jpg",
    plot: "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
    cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain", "Michael Caine"],
    director: "Christopher Nolan",
    language: "English",
    quality: ["720p", "1080p", "4K", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "4K": "https://example.com/download/4k",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/zSWdZVtXT7E",
    featured: false
  },
  {
    id: 4,
    title: "Pulp Fiction",
    year: 1994,
    rating: 8.9,
    genre: ["Crime", "Drama"],
    duration: "154 min",
    poster: "https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg",
    plot: "The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.",
    cast: ["John Travolta", "Uma Thurman", "Samuel L. Jackson", "Bruce Willis"],
    director: "Quentin Tarantino",
    language: "English",
    quality: ["720p", "1080p", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/s7EdQ4FqbhY",
    featured: false
  },
  {
    id: 5,
    title: "The Matrix",
    year: 1999,
    rating: 8.7,
    genre: ["Action", "Sci-Fi"],
    duration: "136 min",
    poster: "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/icmmSD4vTTDKOq2vvdulafOGw93.jpg",
    plot: "When a beautiful stranger leads computer hacker Neo to a forbidding underworld, he discovers the shocking truth--the life he knows is the elaborate deception of an evil cyber-intelligence.",
    cast: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss", "Hugo Weaving"],
    director: "Lana Wachowski, Lilly Wachowski",
    language: "English",
    quality: ["720p", "1080p", "4K", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "4K": "https://example.com/download/4k",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/vKQi3bBA1y8",
    featured: false
  },
  {
    id: 6,
    title: "Fight Club",
    year: 1999,
    rating: 8.8,
    genre: ["Drama"],
    duration: "139 min",
    poster: "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
    plot: "An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into much more.",
    cast: ["Brad Pitt", "Edward Norton", "Meat Loaf", "Helena Bonham Carter"],
    director: "David Fincher",
    language: "English",
    quality: ["720p", "1080p", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/qtRKdVHc-cE",
    featured: false
  },
  {
    id: 7,
    title: "Forrest Gump",
    year: 1994,
    rating: 8.8,
    genre: ["Drama", "Romance"],
    duration: "142 min",
    poster: "https://image.tmdb.org/t/p/w500/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/7c9UVPPiTPltouxRVY6N9udhWId.jpg",
    plot: "The presidencies of Kennedy and Johnson, the Vietnam War, and other historical events unfold from the perspective of an Alabama man with an IQ of 75.",
    cast: ["Tom Hanks", "Robin Wright", "Gary Sinise", "Sally Field"],
    director: "Robert Zemeckis",
    language: "English",
    quality: ["720p", "1080p", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/bLvqoHBptjg",
    featured: false
  },
  {
    id: 8,
    title: "The Shawshank Redemption",
    year: 1994,
    rating: 9.3,
    genre: ["Drama"],
    duration: "142 min",
    poster: "https://image.tmdb.org/t/p/w500/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/kXfqcdQKsToO0OUXHcrrNCHDBzO.jpg",
    plot: "Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.",
    cast: ["Tim Robbins", "Morgan Freeman", "Bob Gunton", "William Sadler"],
    director: "Frank Darabont",
    language: "English",
    quality: ["720p", "1080p", "4K", "WEB-DL"],
    downloadLinks: {
      "720p": "https://example.com/download/720p",
      "1080p": "https://example.com/download/1080p",
      "4K": "https://example.com/download/4k",
      "WEB-DL": "https://example.com/download/webdl"
    },
    videoUrl: "https://www.youtube.com/embed/6hB3S9bIaco",
    featured: false
  }
];

// Get featured movie
export const getFeaturedMovie = () => {
  return moviesData.find(movie => movie.featured) || moviesData[0];
};

// Get latest releases (first 6 movies)
export const getLatestReleases = () => {
  return moviesData.slice(0, 6);
};

// Get trending movies (sorted by rating)
export const getTrendingMovies = () => {
  return [...moviesData].sort((a, b) => b.rating - a.rating).slice(0, 6);
};

// Get movie by ID
export const getMovieById = (id) => {
  return moviesData.find(movie => movie.id === parseInt(id));
};

// Search movies (ready for API integration)
export const searchMovies = (query) => {
  return moviesData.filter(movie => 
    movie.title.toLowerCase().includes(query.toLowerCase())
  );
};
