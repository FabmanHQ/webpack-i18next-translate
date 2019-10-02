# webpack-i18next-translate

[18next](https://www.i18next.com) translation plugin for Webpack

## Idea

This plugin…
* automatically extracts all i18n keys and default values from HTML templates and JS files
* dynamically generates or updates the existing default translation file (and serves the updated version from memory in development)
* creates an index file to look up the name of the final translation files, so you can use content hashes and aggressive caching.
* can create a diff so you can see added/changed/removed strings that need (re-)translation
* checks your translation files for syntax errors (eg. trailing commas) that could trip up i18next.
* warns about common mistakes like:
	* the same key being used for different messages
	* the same message having different keys
	* the message containing JS interpolation syntax (`${…}`) instead of i18next syntax (`{{…}}`).
	* the message containing HTML markup but not being bound to the htmlcontent of the tag. (Aurelia-specific)

To add minimal build time overhead, the plugin hooks into webpack’s JS parser instead of parsing the JS files itself.

## Usage

Add the plugin to your webpack config and add the included HTML loader for your HTML files.

```JavaScript
const I18nextTranslatePlugin = require('webpack-i18next-translate');

// …
	module: {
		rules: [
			// …
			{test: /\.html$/i, use: [
				//… add all your normal HTML loaders
				I18nextTranslatePlugin.HtmlLoader
			]},
			// …
		],
	},
	plugins: [
		// …
		new I18nextTranslatePlugin({
			// Path to your default translation file
			src: 'locales/en/translation.json',
			// Name of the final default translation file
			dest: 'assets/locales/en/translation.[hash].json',
			// File pattern for all non-default translation files. Defaults to /locales\/([^/]+)\/([^/]+)\.[^\.]+.json$/
			// The first group in the expression must match the locale, the second one the namespace.
			translationFilePattern: …
			// Name of the index file that will be added to the bundle to look up the final json file for a particular language and namespace 
			index: 'translation-index.json',
			// Name of the JS object/function that’s used to translate in JS code. Defaults to 'i18next.t'
			i18nFunctionName: 'i18n.tr',
			// Create a diff file next to your default translation file that contains all keys & strings that were added, removed, or changed wrt. to your current default translation file. Defaults to false
			createDiff: isProductionBuild,
			// Whether to warn about the same string being used for different translation keys. Defaults to false
			duplicateWarnings: true,
			// Array of paths to exclude from JS extraction. Defaults to [path.resolve('./node_modules')]
			excludePaths = …
		}),
		new CopyWebpackPlugin([
			// … copy all your non-default translation files to your final bundle (the plugin doesn’t do this automatically yet 😢)
			{from: 'locales/*/*.json', to: 'assets/[path][name].[hash].[ext]', context: '.', ignore: ['**/en/translation.json']},
		])
	],
```

## Extracting default values from JS

Unfortunately, i18next’s translation function doesn’t take a default value. But it’s really useful to see the actual message next to the translation key and extract it automatically. To enable this, change all your calls to the translation function by adding the default text as the third argument:
```JavaScript
// Original
i18next.t('form.unsavedChanged', {});
// New form
i18next.t('form.unsavedChanged', {}, 'You have unsaved changes! Do you really want to leave this page?');
```
The third argument is ignored by i18next, but picked up by the `webpack-i18next-translate` plugin.

If you use TypeScript, it will complain that `i18next.t` only requires two paramters. You might want to ignore this:
```JavaScript
// @ts-ignore
i18next.t('form.unsavedChanged', {}, 'You have unsaved changes! Do you really want to leave this page?');
```


## Index file

The generated index file will have the following format:
```JSON
{
    "en": {
        "translation": "assets/locales/en/translation.afd17cbce4a9ec8aa31ebf21b334a887.json"
    },
    "de": {
        "translation": "assets/locales/de/translation.bb77d8648ff2239aee123b5363baeb84.json"
    },
    …
}
```

You can use the index file to look up the name of the current translations, if you load them from your server. For example, for the `i18next-fetch-backend`, you can use:

```JavaScript
	backend: {
		loadPath(language, namespace) {
			const lngNamespaces = translationIndex[language];
			if (!lngNamespaces) {
				return null;
			}
			return lngNamespaces[namespace];
		}
	}
```

## Diff file

If you set `createDiff: true`, the plugin will create a `.diff.json` file next to your default translation file. The content looks like this:

```JSON
{
	"new": {
		"nav": {
			"Charts": "Charts"
		}
	},
	"changed": {
		"discount": "Your discount"
	},
	"removed": {
		"datepicker": {
			"today": "Today"
		},
		"form": {
			"unsavedChanged": "You have unsaved changes! Do you really want to leave this page?"
		},
	}
}
```

This lets you know what you need to change in your non-default translation files. Once you've updated them, update your default translation file (or copy the content of the translation file from the compiled bundle) to reset the diff.
