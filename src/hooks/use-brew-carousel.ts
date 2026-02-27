import { useState, useEffect } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { toast as sonnerToast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTvMode } from '@/contexts/TvModeContext';
import { useSearchParams } from 'react-router-dom';

interface Brew {
  batch_id: string;
  name: string;
  [key: string]: any;
}

/**
 * Manages carousel state, embla instance, focused brew scrolling,
 * and selection index for mobile brew card swiping.
 */
export function useBrewCarousel(brews: Brew[]) {
  const isMobile = useIsMobile();
  const { isTvMode } = useTvMode();
  const [searchParams] = useSearchParams();
  const focusedBrewId = searchParams.get('brew');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const shouldUseCarousel = isMobile && !isTvMode;
  const [emblaRef, emblaApi] = useEmblaCarousel(shouldUseCarousel ? {
    loop: false,
    align: 'center',
  } : undefined);

  // Scroll to focused brew when URL param is present
  useEffect(() => {
    if (!focusedBrewId || !emblaApi || !shouldUseCarousel || brews.length === 0) return;
    let brewIndex = brews.findIndex(b => b.batch_id === focusedBrewId);
    if (brewIndex === -1) {
      brewIndex = brews.findIndex(b => {
        const brewSlug = b.name.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return brewSlug === focusedBrewId;
      });
    }
    if (brewIndex !== -1) {
      emblaApi.scrollTo(brewIndex);
      sonnerToast(`${brews[brewIndex].name} är i fokus`, {
        description: 'Detta öl delades med dig',
        duration: 3000,
      });
    }
  }, [focusedBrewId, emblaApi, brews, shouldUseCarousel]);

  // Selection handler
  useEffect(() => {
    if (!emblaApi || !shouldUseCarousel) return;
    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    };
    emblaApi.on('select', onSelect);
    onSelect();
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi, shouldUseCarousel]);

  return {
    emblaRef,
    emblaApi,
    selectedIndex,
    shouldUseCarousel,
    isMobile,
    isTvMode,
  };
}
