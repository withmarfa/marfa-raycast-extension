/**
 * The `@raycast/utils` runtime, doubled only where something under test loads
 * it. Like its sibling stub this exists because the package is unusable outside
 * Raycast, not to simulate behavior.
 *
 * `runAppleScript` throws rather than returning a value. Nothing under test
 * calls it, and a double that quietly answered would let a test think it had
 * exercised the location shortcut when it had exercised this file.
 */
export function runAppleScript(): Promise<string> {
  throw new Error('runAppleScript is not doubled: nothing under test should be shelling out');
}
