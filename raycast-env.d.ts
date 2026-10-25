/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Server URL - Where your Marfa server answers */
  "apiUrl": string,
  /** API Key - A key minted for Raycast, for example with `marfa keys create` */
  "apiKey": string,
  /** Default Capture Type - The type Create Item starts on, as a type identifier such as core.note or core.task */
  "defaultCaptureType": string,
  /** Default Tier - Where captures land: the library keeps what you chose to keep, the feed holds what arrives in volume */
  "defaultTier": "library" | "feed",
  /** Selected Text - Create Item starts from the text selected in the frontmost app when there is some, and blank otherwise */
  "preferSelectedText": boolean,
  /** Default Tags - Comma-separated tags every capture starts with */
  "defaultTags"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `browse` command */
  export type Browse = ExtensionPreferences & {}
  /** Preferences accessible in the `create-item` command */
  export type CreateItem = ExtensionPreferences & {}
  /** Preferences accessible in the `type-registry` command */
  export type TypeRegistry = ExtensionPreferences & {}
  /** Preferences accessible in the `manage-keys` command */
  export type ManageKeys = ExtensionPreferences & {}
  /** Preferences accessible in the `status` command */
  export type Status = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `browse` command */
  export type Browse = {}
  /** Arguments passed to the `create-item` command */
  export type CreateItem = {}
  /** Arguments passed to the `type-registry` command */
  export type TypeRegistry = {}
  /** Arguments passed to the `manage-keys` command */
  export type ManageKeys = {}
  /** Arguments passed to the `status` command */
  export type Status = {}
}

