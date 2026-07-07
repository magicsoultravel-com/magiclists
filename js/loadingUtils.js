/**
 * LoadingManager - Provides consistent loading indicators and feedback
 * for asynchronous operations throughout the application
 */
export const LoadingManager = {
  /**
   * Show loading indicator on an element
   * @param {HTMLElement} element - The element to show loading state on
   * @param {string} message - Optional accessibility message for screen readers
   */
  show(element, message = 'Loading...') {
    if (!element) return;
    
    element.classList.add('is-loading');
    
    // Remove any existing indicator to avoid duplicates
    const existingIndicator = element.querySelector('.loading-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    // Create and add loading indicator
    const indicator = document.createElement('div');
    indicator.className = 'loading-indicator';
    indicator.setAttribute('aria-label', message);
    element.appendChild(indicator);
  },
  
  /**
   * Hide loading indicator on an element
   * @param {HTMLElement} element - The element to remove loading state from
   */
  hide(element) {
    if (!element) return;
    
    element.classList.remove('is-loading');
    
    // Remove the loading indicator
    const indicator = element.querySelector('.loading-indicator');
    if (indicator) {
      indicator.remove();
    }
  },
  
  /**
   * Create a standalone loading indicator element
   * @param {string} message - Accessibility message for screen readers
   * @returns {HTMLElement} - The loading indicator element
   */
  createIndicator(message = 'Loading...') {
    const indicator = document.createElement('div');
    indicator.className = 'loading-indicator';
    indicator.setAttribute('aria-label', message);
    return indicator;
  }
};