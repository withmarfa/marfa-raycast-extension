/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Server URL - Myme server URL */
  "apiUrl": string,
  /** API Key - Optional dev/escape-hatch API key. Use the Sign in to Myme command for normal use. */
  "apiKey"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `login` command */
  export type Login = ExtensionPreferences & {}
  /** Preferences accessible in the `logout` command */
  export type Logout = ExtensionPreferences & {}
  /** Preferences accessible in the `browse` command */
  export type Browse = ExtensionPreferences & {}
  /** Preferences accessible in the `search` command */
  export type Search = ExtensionPreferences & {}
  /** Preferences accessible in the `quick-capture` command */
  export type QuickCapture = ExtensionPreferences & {}
  /** Preferences accessible in the `clipboard-capture` command */
  export type ClipboardCapture = ExtensionPreferences & {}
  /** Preferences accessible in the `manage-keys` command */
  export type ManageKeys = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `login` command */
  export type Login = {}
  /** Arguments passed to the `logout` command */
  export type Logout = {}
  /** Arguments passed to the `browse` command */
  export type Browse = {}
  /** Arguments passed to the `search` command */
  export type Search = {}
  /** Arguments passed to the `quick-capture` command */
  export type QuickCapture = {}
  /** Arguments passed to the `clipboard-capture` command */
  export type ClipboardCapture = {}
  /** Arguments passed to the `manage-keys` command */
  export type ManageKeys = {}
}

