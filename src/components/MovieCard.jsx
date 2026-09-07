import React from 'react';
import { Link } from 'react-router-dom';
import { Star, Clock } from 'lucide-react';

const MovieCard = ({ movie }) => {
  return (
    <Link to={`/movie/${movie.id}`} className="group block">
      <div className="backdrop-blur-md bg-white/5 rounded-xl overflow-hidden border border-white/10 hover:border-[#ff9900] transition-all duration-300 shadow-lg hover:shadow-[#ff9900]/20 transform hover:-translate-y-2">
        {/* Poster Image */}
        <div className="relative overflow-hidden aspect-[2/3]">
          <img
            src={movie.poster || movie.poster_large || movie.medium_cover_image}
            alt={movie.title}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              e.target.src = 'https://via.placeholder.com/300x450?text=No+Poster';
            }}
          />
          
          {/* Overlay on Hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          {/* IMDb Rating Badge */}
          {movie.rating && (
            <div className="absolute top-3 right-3 backdrop-blur-md bg-[#ff9900]/90 text-white px-2 py-1 rounded-md flex items-center space-x-1 font-bold text-sm shadow-lg">
              <Star className="w-4 h-4 fill-current" />
              <span>{movie.rating}</span>
            </div>
          )}
        </div>

        {/* Movie Info */}
        <div className="p-4 backdrop-blur-md bg-white/5">
          <h3 className="text-white font-bold text-lg mb-1 truncate group-hover:text-[#ff9900] transition-colors duration-300">
            {movie.title}
          </h3>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{movie.year}</span>
            {movie.runtime && (
              <div className="flex items-center space-x-1 text-slate-400">
                <Clock className="w-4 h-4" />
                <span>{movie.runtime} min</span>
              </div>
            )}
          </div>

          {/* Genres */}
          <div className="mt-2 flex flex-wrap gap-1">
            {movie.genres && movie.genres.slice(0, 2).map((genre, index) => (
              <span
                key={index}
                className="text-xs backdrop-blur-md bg-white/5 text-[#ff9900] px-2 py-1 rounded-full border border-white/10"
              >
                {genre}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MovieCard;