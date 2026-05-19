/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Server URL - Myme server URL */
  "apiUrl": string,
  /** API Key - Optional dev/escape-hatch API key. Normal use signs in via OAuth on first command run. */
  "apiKey"?: string,
  /** Default tier - Tier stamped on captured items by default */
  "defaultTier": "library" | "feed",
  /** Default capture type - Preselected type in Quick Capture and Clipboard Capture (Edit). Can be any registered Myme type. File and URL clipboard routing still win. */
  "defaultCaptureType": string,
  /** Default tags - Comma-separated tags applied to every capture (e.g. raycast, mobile) */
  "defaultTags"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `browse` command */
  export type Browse = ExtensionPreferences & {}
  /** Preferences accessible in the `search` command */
  export type Search = ExtensionPreferences & {}
  /** Preferences accessible in the `quick-capture` command */
  export type QuickCapture = ExtensionPreferences & {}
  /** Preferences accessible in the `clipboard-capture` command */
  export type ClipboardCapture = ExtensionPreferences & {}
  /** Preferences accessible in the `clipboard-capture-edit` command */
  export type ClipboardCaptureEdit = ExtensionPreferences & {}
  /** Preferences accessible in the `manage-keys` command */
  export type ManageKeys = ExtensionPreferences & {}
  /** Preferences accessible in the `server-info` command */
  export type ServerInfo = ExtensionPreferences & {}
  /** Preferences accessible in the `type-registry` command */
  export type TypeRegistry = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `browse` command */
  export type Browse = {}
  /** Arguments passed to the `search` command */
  export type Search = {}
  /** Arguments passed to the `quick-capture` command */
  export type QuickCapture = {}
  /** Arguments passed to the `clipboard-capture` command */
  export type ClipboardCapture = {}
  /** Arguments passed to the `clipboard-capture-edit` command */
  export type ClipboardCaptureEdit = {}
  /** Arguments passed to the `manage-keys` command */
  export type ManageKeys = {}
  /** Arguments passed to the `server-info` command */
  export type ServerInfo = {}
  /** Arguments passed to the `type-registry` command */
  export type TypeRegistry = {}
}

