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
    addGlobal: "Add a global extension exception",
    addFile: "Add an extension exception for this file",
    addFolder: "Add an extension exception for this folder",
    section: {
      title: "Exceptions: these extensions do not use the values above",
      desc: "An exception only rewrites the fields you customize; the rest follow this layer.",
    },
    extension: {
      name: "Extension",
      desc: "Regular expression matching the attachment extension. The first match in the list wins.",
      placeholder: "pdf|docx?",
    },
    inherit: "Inherit this layer",
    customize: "Customize",
    inheritValue: "Inherit: {value}",
    emptyValue: "(empty)",
    remove: "Remove this exception",
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
      desc: "Extensions listed here are not treated as attachments, matched as a regular expression against the extension without the leading dot.",
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
    arrangeCompleted: "Arrange completed",
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
    canvasNotSupported: "Canvas is not supported as an extension exception.",
    markdownNotSupported: "Markdown is not supported as an extension exception.",
    extensionEmpty: "Extension exception cannot be empty.",
    duplicateExtension: "Duplicate extension exception.",
    excludedExtension: "Extension exception cannot be an excluded extension.",
    attachFormatEmpty: "Attachment name cannot be empty.",
    attachFormatIllegalChar: "Attachment name contains illegal filename character: {char}",
    attachFormatUnknownVariable: "Unknown variable in attachment name: {name}",
    attachmentPathEmpty: "Attachment folder cannot be empty.",
    attachmentPathIllegalChar: "Attachment folder contains illegal filename character: {char}",
    attachmentPathUnknownVariable: "Unknown variable in attachment folder: {name}",
  },
} as const satisfies TranslationMap;
