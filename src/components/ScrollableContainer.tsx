import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import './styles/ScrollableContainerStyle.css';

interface ScrollableContainerProps {
  children: React.ReactNode;
  className?: string;
  arrowColor?: string;
}

export default function ScrollableContainer({ children, className = '', arrowColor = 'var(--accent-color)' }: ScrollableContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showTopArrow, setShowTopArrow] = useState(false);
  const [showBottomArrow, setShowBottomArrow] = useState(false);

  const checkScrollPosition = () => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    
    // Show top arrow if scrolled down
    setShowTopArrow(scrollTop > 20);
    
    // Show bottom arrow if there's more content to scroll to
    setShowBottomArrow(scrollHeight - scrollTop - clientHeight > 20);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // Initial check
    checkScrollPosition();
    
    // Add event listener for scroll
    container.addEventListener('scroll', checkScrollPosition);
    
    // Check again after content might have changed/loaded
    const resizeObserver = new ResizeObserver(() => {
      checkScrollPosition();
    });
    
    resizeObserver.observe(container);
    
    return () => {
      container.removeEventListener('scroll', checkScrollPosition);
      resizeObserver.disconnect();
    };
  }, []);

  const scrollToTop = () => {
    containerRef.current?.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const scrollToBottom = () => {
    if (!containerRef.current) return;
    containerRef.current.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'smooth'
    });
  };

  return (
    <div className="scroll-container-wrapper">
      {showTopArrow && (
        <div 
          className="scroll-arrow scroll-arrow-top"
          onClick={scrollToTop}
          style={{ color: arrowColor }}
        >
          <ChevronUp size={24} />
        </div>
      )}
      
      <div 
        ref={containerRef}
        className={`scrollable-content ${className}`}
      >
        {children}
      </div>
      
      {showBottomArrow && (
        <div 
          className="scroll-arrow scroll-arrow-bottom"
          onClick={scrollToBottom}
          style={{ color: arrowColor }}
        >
          <ChevronDown size={24} />
        </div>
      )}
    </div>
  );
}