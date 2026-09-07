import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';

const MovieCarousel = ({ title, movies }) => {
  const scrollRef = useRef(null);

  const scroll = (direction) => {
    const container = scrollRef.current;
    if (container) {
      const scrollAmount = direction === 'left' ? -400 : 400;
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div className="mb-12">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold text-white">
          {title}
        </h2>
        
        {/* Navigation Buttons */}
        <div className="flex space-x-2">
          <button
            onClick={() => scroll('left')}
            className="backdrop-blur-md bg-white/5 hover:bg-[#ff9900] text-white hover:text-white p-2 rounded-lg transition-all duration-300 border border-white/10 hover:border-[#ff9900]"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="backdrop-blur-md bg-white/5 hover:bg-[#ff9900] text-white hover:text-white p-2 rounded-lg transition-all duration-300 border border-white/10 hover:border-[#ff9900]"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Carousel */}
      <div
        ref={scrollRef}
        className="flex space-x-4 overflow-x-auto hide-scrollbar pb-4"
      >
        {movies.map((movie) => (
          <div key={movie.id} className="flex-shrink-0 w-64">
            <MovieCard movie={movie} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default MovieCarousel;