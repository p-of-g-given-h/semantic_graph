import { Plugin } from "obsidian";
import { registerBulletEditorExtension } from "./editor-bullets";
import { registerSemanticGraphInCoreGraphView } from "./graph";
import { registerBulletPreviewPostProcessor } from "./preview-bullets";
import {
	DEFAULT_SETTINGS,
	type SemanticGraphPluginSettings,
} from "./settings";

export default class SemanticGraphPlugin extends Plugin {
	settings: SemanticGraphPluginSettings = DEFAULT_SETTINGS;

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SemanticGraphPluginSettings>,
		);

		registerBulletEditorExtension(this);
		registerBulletPreviewPostProcessor(this);
		registerSemanticGraphInCoreGraphView(this);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
