/**
 * ========================================
 * E2E TEST MODE CONFIGURATION
 * ========================================
 * 
 * This configuration enables end-to-end testing of Marionette using predefined
 * voice inputs. The microphone is still activated (to test permissions), but
 * voice input is provided from the TEST_PHRASES array.
 * 
 * HOW TO USE:
 * 1. Set TEST_MODE_ENABLED to true
 * 2. Edit TEST_PHRASES array to configure test inputs
 * 3. Each time you click the microphone, it will use the next phrase in the list
 * 4. Phrases are streamed word-by-word like natural speech recognition
 * 5. Set TEST_MODE_ENABLED to false to use live speech recognition
 * 
 * USE CASES:
 * - End-to-end testing of agent workflows
 * - Automated testing with controlled inputs
 * - Demonstrate system behavior reliably
 * - Verify agent tool usage and response patterns
 */

export const E2E_TEST_CONFIG = {
  /**
   * Enable test mode to use predefined phrases as voice input
   * Set to false in production to use live Web Speech API
   */
  TEST_MODE_ENABLED: false,

  /**
   * Test phrases that will be used as voice input in test mode.
   * Phrases are used sequentially - the first microphone click uses the first phrase,
   * the second click uses the second phrase, etc.
   * 
   * After the last phrase, it cycles back to the beginning.
   */
  TEST_PHRASES: [
    // Add more test phrases here as needed
  ],

  /**
   * Delay before starting phrase recognition (milliseconds)
   * Provides processing time before speech recognition begins
   */
  INITIAL_DELAY: 2000,

  /**
   * Delay between each word during phrase streaming (milliseconds)
   * Matches the progressive nature of live speech recognition
   */
  WORD_DELAY: 300,

  /**
   * Delay after phrase completion before auto-ending (milliseconds)
   * Matches the pause detection that ends live speech recognition
   */
  AUTO_END_DELAY: 1000,

  /**
   * Skip the "Loading model..." warmup phase and its associated events
   * Set to true to eliminate warmup overhead in testing
   * Set to false to test the full user experience including warmup
   */
  SKIP_WARMUP_PHASE: false,

  /**
   * Enable automated UI testing mode
   * 
   * When enabled, specific user inputs trigger automated test flows that validate
   * the UI's ability to execute tool calls, parse results, and interact with forms.
   */
  ENABLE_UI_TEST_MODE: false,

  /**
   * Automated UI test cases
   * 
   * Each test case validates a specific user workflow by executing actual tool calls
   * against live web pages. Tests dynamically extract page data (form field indices, etc.)
   * to ensure they work across different page states and real-world conditions.
   * 
   * Test cases validate:
   * - Tool execution correctness
   * - Result parsing and data extraction
   * - Multi-step workflow coordination
   * - Form interaction reliability
   * - UI state management
   */
  UI_TEST_CASES: []
}

