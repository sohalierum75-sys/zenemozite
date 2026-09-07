import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Download, Info, Star } from 'lucide-react';

const HeroBanner = ({ media, mediaType = 'movie' }) => {
  if (!media) return null;

  const title = media.title || media.name;
  const date = media.release_date || media.first_air_date || media.year;
  const year = date ? new Date(date).getFullYear() : media.year;
  const backdrop = media.backdrop || media.poster;
  const plot = media.plot || media.summary || media.overview || 'No description available.';
  const rating = media.rating || media.vote_average;
  const runtime = media.runtime || media.episode_run_time?.[0];
  const genres = media.genres || [];
  
  const linkPath = mediaType === 'tv' ? `/tv/${media.id}` : `/movie/${media.id}`;

  return (
    <div className="relative h-[70vh] md:h-[80vh] overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={backdrop}
          alt={title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.src = media.poster || 'https://via.placeholder.com/1920x1080?text=No+Image';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0f1115] via-[#0f1115]/90 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] via-transparent to-transparent" />
      </div>

      <div className="relative z-10 h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center">
        <div className="max-w-2xl">
          <div className="inline-flex items-center space-x-2 bg-[#ff9900] text-[#0f1115] px-4 py-2 rounded-full font-bold mb-4 shadow-lg shadow-[#ff9900]/20 animate-fadeInUp">
            <span className="w-2 h-2 bg-[#0f1115] rounded-full animate-pulse" />
            <span>{mediaType === 'tv' ? 'FEATURED TV SHOW' : 'FEATURED MOVIE'}</span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white mb-4 leading-tight tracking-tight animate-fadeInUp stagger-1">
            {title}
          </h1>

          <div className="flex items-center space-x-4 text-[#8b94a6] mb-6 animate-fadeInUp stagger-2">
            {year && (
              <>
                <span className="text-[#ff9900] font-bold text-lg">{year}</span>
                <span>•</span>
              </>
            )}
            {runtime && (
              <>
                <span>{runtime} min</span>
                <span>•</span>
              </>
            )}
            {rating && (
              <div className="flex items-center space-x-1">
                <Star className="w-5 h-5 text-[#ff9900] fill-[#ff9900]" />
                <span className="text-white font-semibold">{typeof rating === 'number' ? rating.toFixed(1) : rating}</span>
              </div>
            )}
          </div>

          <p className="text-[#8b94a6] text-lg mb-8 line-clamp-3 animate-fadeInUp stagger-3">
            {plot}
          </p>

          {genres.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8 animate-fadeInUp stagger-4">
              {genres.slice(0, 4).map((genre, index) => (
                <span
                  key={index}
                  className="bg-white/5 backdrop-blur-md text-[#ff9900] px-4 py-1 rounded-full text-sm border border-white/10"
                >
                  {typeof genre === 'string' ? genre : genre.name}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 animate-fadeInUp stagger-5">
            <Link
              to={linkPath}
              className="bg-[#ff9900] text-[#0f1115] font-bold px-8 py-4 rounded-xl flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg shadow-[#ff9900]/20 hover:scale-105"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Watch Now | දැන් නරඹන්න</span>
            </Link>
            <Link
              to={linkPath}
              className="bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-bold px-8 py-4 rounded-xl flex items-center justify-center space-x-2 transition-all duration-300 border border-white/10 hover:border-white/20"
            >
              <Download className="w-5 h-5" />
              <span>Download | බාගත කරන්න</span>
            </Link>
            <Link
              to={linkPath}
              className="bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-bold px-8 py-4 rounded-xl flex items-center justify-center space-x-2 transition-all duration-300 border border-white/10 hover:border-white/20"
            >
              <Info className="w-5 h-5" />
              <span>More Info | තව විස්තර</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroBanner;
