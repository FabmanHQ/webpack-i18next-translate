'use strict';

const cheerio = require('cheerio');

function findTranslations(html) {
	const $ = cheerio.load(html, {
		xml: {
			xmlMode: false,
		}
	});
	const templates =  $('template');
	const translations = [];
	if (templates.length) {
		templates.each((__i, el) => {
			translations.push(...findTranslations.call(this, $(el).html()));
		});
	}

	$('[t]').each((__i, el) => {
		parseTranslations.call(this, $(el)).forEach(({key, value}) => {
			if (value && value.indexOf('${') !== -1) {
				this.emitWarning(new Error(`Translation key "${key}" contains Aurelia interpolation:\n\t${value}`));
			}
			translations.push({key, value});
		});
	});
	return translations;
}

const attrExp = /\[([a-z\-]*)\]/i;

function parseTranslations(element) {
	const keys = element.attr('t').split(';');
	return keys.map((key) => {
		let attr = element.is('img') ? 'src' : 'text';
		// check if a attribute was specified in the key
		const match = attrExp.exec(key);
		if (match) {
			key = key.replace(match[0], '');
			attr = match[1];
		}

		let value;
		switch (attr) {
			case 'text':
				value = element.text().trim();
				if (element.find('*').length) {
					this.emitWarning(new Error(`Translation key "${key}" contains HTML elements but is bound as text:\n\tText: ${value}\n\tHtml: ${element.html().trim()}`));
				}
				break;
			case 'prepend':
			case 'append':
			case 'html':
				value = element.html().trim();
				break;
			default:
				value = element.attr(attr);
				break;
		}
		return {key, value};
	});
}

const transSymbol = Symbol('HTML translations');

function htmlTranslationLoader(content) {
	if (this.cacheable) {
		this.cacheable();
	}
	// console.log('Looking for translations in ', this._module.request);
	const translations = findTranslations.call(this, content);
	this._module[transSymbol] = translations;
	return content;
}
htmlTranslationLoader.symbol = transSymbol;

module.exports = htmlTranslationLoader;
