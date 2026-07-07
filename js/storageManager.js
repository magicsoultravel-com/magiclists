/**
 * StorageManager - Centralized storage handling with versioning
 * Replaces direct localStorage usage throughout the application
 */
export const StorageManager = {
  VERSION: '1.0',
  STORAGE_KEY: 'magiclists_workspace',
  
  /**
   * Save state to localStorage with versioning
   * @param {Object} state - The state object to save
   * @returns {boolean} - True if successful, false otherwise
   */
  save(state) {
    try {
      const versionedState = {
        _version: this.VERSION,
        _timestamp: Date.now(),
        data: state
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(versionedState));
      return true;
    } catch (e) {
      console.error('Failed to save workspace:', e);
      return false;
    }
  },
  
  /**
   * Load state from localStorage with version checking
   * @returns {Object|null} - The loaded state or null if failed/invalid
   */
  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      
      const parsed = JSON.parse(raw);
      // Handle version migration if needed
      if (parsed._version !== this.VERSION) {
        return this.migrateState(parsed);
      }
      return parsed.data;
    } catch (e) {
      console.error('Failed to load workspace:', e);
      return null;
    }
  },
  
  /**
   * Migrate state from older versions
   * @param {Object} oldState - The state object from older version
   * @returns {Object|null} - Migrated state or null if migration not possible
   */
  migrateState(oldState) {
    // For now, we'll warn and return null to force fresh start on version mismatch
    // In future versions, implement actual migration logic here
    console.warn('Workspace version mismatch, starting fresh');
    return null;
  },
  
  /**
   * Clear all stored data
   */
  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },
  
  /**
   * Get storage key for testing/debugging
   * @returns {string} - The storage key used
   */
  getStorageKey() {
    return this.STORAGE_KEY;
  }
};