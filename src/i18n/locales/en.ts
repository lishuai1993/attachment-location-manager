import type { TranslationMap } from "../index";

export const en = {
  common: {
    cancel: "Cancel",
  },

  order: {
    prefix: "Resolution order: ",
    file: "file override",
    folder: "nearest ancestor folder override",
    global: "global default",
    separator: " ▶ ",
  },

  layer: {
    global: "Global default",
    file: "This file's settings",
    folder: "This folder's settings",
  },

  exception: {
    addGlobal: "Add a global special case",
    addFile: "Add a special case for this file",
    addFolder: "Add a special case for this folder",
    section: {
      title: "Special cases: these extensions take their own values instead of the ones above",
      desc: "A special case waives nothing; it only rewrites the fields you customize, and the rest follow this layer.",
    },
    extension: {
      name: "Extension",
      desc: "Regular expression matching the attachment extension, case-insensitively. The first match in the list wins.",
      placeholder: "pdf|docx?",
    },
    inherit: "Inherit this layer",
    customize: "Customize",
    inheritValue: "Inherit: {value}",
    emptyValue: "(empty)",
    remove: "Remove this special case",
    rootFolderDesc: "Only used when the root path is not “Copy Obsidian settings”.",
  },

  settings: {
    title: "Global attachment settings",
    others: "Other settings",
    rootPath: {
      name: "Root path to save attachment",
      desc: "Select root path of attachment",
      options: {
        obsidian: "Copy Obsidian settings",
        inFolder: "In the folder specified below",
        nextToNote: "Next to note in folder specified below",
      },
    },
    rootFolder: {
      name: "Attachment root folder",
      desc: "Root folder of new attachment. Folders already in the vault are suggested as you type.",
    },
    attachmentPath: {
      name: "Attachment folder",
      desc: "Folder of attachment in the root folder, available variables ${notepath}, ${notename}, ${parent}",
    },
    attachmentFormat: {
      name: "Attachment name",
      desc: "Define how to name the attachment file, available variables ${date}, ${notename}, ${md5} and ${originalname}.",
    },
    dateFormat: {
      name: "Date format",
      desc: "Moment date format to use",
      linkText: "Moment format options",
    },
    autoRename: {
      name: "Automatically rename attachment",
      desc: "Automatically rename the attachment folder/filename when you rename the folder/filename where the corresponding md/canvas file be placed.",
    },
    excludeExtension: {
      name: "Excluded from attachments",
      desc: "Extensions listed here are not treated as attachments, matched as a regular expression against the extension without the leading dot and case-insensitively. Left empty, every non-note file is treated as an attachment.",
      placeholder: "pdf|docx?|xlsx?|pptx?|zip|rar",
    },
    excludedPaths: {
      name: "Unmanaged note folders",
      desc: "Notes in these folders are left unmanaged. Provide the full path list (case sensitive, no leading slash '/'), separated by semicolons (;).",
    },
    excludeSubpaths: {
      name: "Include subfolders",
      desc: "Applies to subfolders of the folders above as well.",
    },
    overrideList: {
      name: "Overrides",
      empty: "No override yet. Right-click a file or folder and pick “Override global attachment settings”.",
      typeFile: "File override",
      typeFolder: "Folder override",
      kindFile: "file",
      kindFolder: "folder",
      // The trailing space is the joiner before the status element that follows.
      overview: "Overview: {type}, ",
      valueEmpty: "(empty)",
      fieldMode: "Root mode: {value}",
      fieldRoot: "Root: {value}",
      fieldPath: "Folder: {value}",
      fieldFormat: "Name: {value}",
      statusOk: "target exists",
      statusMissing: "target no longer exists — this override is dead",
      statusMismatch: "but a {actual} now sits at this path — this override is dead",
      remove: "Remove this override",
    },
    diagnostics: {
      name: "Diagnostics",
      enable: {
        name: "Write diagnostic log",
        desc: "Write a diagnostic log to {path} for troubleshooting. WARN and ERROR entries are always recorded; turning this on also records INFO and TRACE entries. Every plugin reload rotates the log to log.txt.bak and clears the current file.",
      },
    },
  },

  override: {
    title: "Override global attachment settings: {path}",
    menuTitle: "Override global attachment settings",
    buttons: {
      reset: "Remove this override",
      submit: "Confirm",
    },
    notifications: {
      reset: "Removed the override of {path}",
      overridden: "Overrode global attachment settings for {path}",
    },
  },

  confirm: {
    title: "Tips",
    message:
      "This operation is irreversible and experimental. Please backup your vault first! Are you sure you want to continue?",
    continue: "Yes",
  },

  notices: {
    fileExcluded: "{path} was excluded",
    overrideRemoved: "Removed the override of {path}",
    fileRenamed: "Renamed {from} to {to}",
    filesRenamedBatch: "Renamed {count} attachments",
    arrangeNothingFound: "Nothing to rearrange",
    arrangeSummary: "Arrange finished: {moved} moved, {copied} copied, {skipped} skipped, {failed} failed",
    noActiveNote: "Open a note or canvas first",
    resetAttachmentSetting: "Removed the override of {path}",
    error: {
      unknownError: "An unknown error occurred",
    },
  },

  commands: {
    rearrangeAllLinks: "Rearrange all linked attachments",
    rearrangeActiveLinks: "Rearrange linked attachments",
    overrideSetting: "Override global attachment settings",
    resetOverrideSetting: "Remove this override: {path}",
    clearUnusedStorage: "Clear unused original name storage",
  },

  errors: {
    canvasNotSupported: "Canvas cannot be used as a special case.",
    markdownNotSupported: "Markdown cannot be used as a special case.",
    extensionEmpty: "A special case needs an extension.",
    duplicateExtension: "A special case with this extension already exists.",
    excludedExtension: "This extension is excluded from attachments, so it cannot be a special case.",
    exceptionRejected: "An extension on a special case card did not pass validation. Correct it or remove that card.",
    attachFormatEmpty: "Attachment name cannot be empty.",
    attachFormatIllegalChar: "Attachment name contains illegal filename character: {char}",
    attachFormatUnknownVariable: "Unknown variable in attachment name: {name}",
    attachmentPathEmpty: "Attachment folder cannot be empty.",
    attachmentPathIllegalChar: "Attachment folder contains illegal filename character: {char}",
    attachmentPathUnknownVariable: "Unknown variable in attachment folder: {name}",
  },
} as const satisfies TranslationMap;
