import { NotificationsSoundPlayer } from "./NotificationsSoundPlayer.js";
var SoundPlayer = new NotificationsSoundPlayer();

//const TYPE_SHOW_ALL = -1;
const TYPE_REGULAR = 0;
const TYPE_ZEROETV = 1;
const TYPE_HIGHLIGHT = 2;
const TYPE_HIGHLIGHT_OR_ZEROETV = 9;

class NotificationMonitor {
	#feedPaused;

	async initialize() {
		//Remove the existing items.
		document.getElementById("vvp-items-grid").innerHTML = "";

		//Remove the item count
		document.querySelector("#vvp-items-grid-container>p").remove();

		//Remove the navigation
		document.querySelector("#vvp-items-grid-container > div[role=navigation]").remove();

		//Remove the categories
		document.querySelector("#vvp-browse-nodes-container").remove();

		//Create title
		const parentContainer = document.querySelector("div.vvp-tab-content");
		const mainContainer = document.querySelector("div.vvp-items-container");

		//Insert the header
		let prom2 = await Tpl.loadFile("view/notification_monitor_header.html");
		const header = Tpl.render(prom2, true);
		parentContainer.insertBefore(header, mainContainer);

		//Bind fetch-last-100 button
		const btnLast100 = document.getElementById("fetch-last-100");
		btnLast100.addEventListener("click", (event) => {
			browser.runtime.sendMessage({
				type: "fetchLast100Items",
			});
		});

		//Bind Pause Feed button
		this.#feedPaused = false;
		const btnPauseFeed = document.getElementById("pauseFeed");
		btnPauseFeed.addEventListener("click", (event) => {
			this.#feedPaused = !this.#feedPaused;
			if (this.#feedPaused) {
				document.getElementById("pauseFeed").value = "Resume Feed";
			} else {
				document.getElementById("pauseFeed").value = "Pause & Buffer Feed";
				document.querySelectorAll(".vvp-item-tile").forEach((node, key, parent) => {
					if (node.dataset.feedPaused == "true") {
						node.style.display = "grid";
						node.dataset.feedPaused = "false";
					}
				});
			}
		});

		//Bind the event when changing the filter
		const filterType = document.querySelector("select[name='filter-type']");
		filterType.addEventListener("change", (event) => {
			//Display a specific type of notifications only
			document.querySelectorAll(".vvp-item-tile").forEach((node, key, parent) => {
				this.#processNotificationFiltering(node);
			});
		});
		const filterQueue = document.querySelector("select[name='filter-queue']");
		filterQueue.addEventListener("change", (event) => {
			//Display a specific type of notifications only
			document.querySelectorAll(".vvp-item-tile").forEach((node, key, parent) => {
				this.#processNotificationFiltering(node);
			});
		});
	}

	async addTileInGrid(
		asin,
		queue,
		date,
		title,
		img_url,
		is_parent_asin,
		enrollment_guid,
		etv_min,
		etv_max,
		KWsMatch,
		BlurKWsMatch
	) {
		if (!asin) {
			return false;
		}

		const recommendationType = getRecommendationTypeFromQueue(queue); //grid.js
		const recommendationId = generateRecommendationString(recommendationType, asin, enrollment_guid); //grid.js

		//If the notification already exist, remove it to avoid duplicates
		document.getElementById("vh-notification-" + asin)?.remove();

		//Add the notification
		let templateFile;
		if (Settings.get("general.listView")) {
			templateFile = "tile_listview.html";
		} else {
			templateFile = "tile_gridview.html";
		}

		let prom2 = await Tpl.loadFile("view/" + templateFile);
		Tpl.setVar("id", asin);
		Tpl.setVar("domain", I13n.getDomainTLD());
		Tpl.setVar("img_url", img_url);
		Tpl.setVar("asin", asin);
		Tpl.setVar("date", this.#formatDate(date));
		Tpl.setVar("feedPaused", this.#feedPaused);
		Tpl.setVar("queue", queue);
		Tpl.setVar("description", title);
		Tpl.setVar("is_parent_asin", is_parent_asin);
		Tpl.setVar("enrollment_guid", enrollment_guid);
		Tpl.setVar("recommendationType", recommendationType);
		Tpl.setVar("recommendationId", recommendationId);
		Tpl.setIf("announce", Settings.get("discord.active") && Settings.get("discord.guid", false) != null);
		Tpl.setIf("pinned", Settings.get("pinnedTab.active"));
		Tpl.setIf("variant", Settings.isPremiumUser() && Settings.get("general.displayVariantIcon") && is_parent_asin);

		let tileDOM = Tpl.render(prom2, true);
		const container = document.querySelector("#vvp-items-grid");
		container.insertBefore(tileDOM, container.firstChild);

		//If we received ETV data (ie: Fetch last 100), process them
		if (etv_min != null && etv_max != null) {
			//Set the ETV but take no action on it
			this.setETV(asin, etv_min, false); //Don't process potential 0etv, just set the ETV
			this.setETV(asin, etv_max, false); //Don't process potential 0etv, just set the ETV

			//We found a zero ETV item, but we don't want to play a sound just yet
			if (parseFloat(etv_min) == 0) {
				this.#zeroETVItemFound(asin, false); //Ok now process 0etv, but no sound
			}
		} else {
			//The ETV is not known
			const brendaAnnounce = tileDOM.querySelector("#vh-announce-link-" + asin);
			if (brendaAnnounce) {
				brendaAnnounce.style.visibility = "hidden";
			}
		}

		//Process the item according to the notification type (highlight > 0etv > regular)
		//This is what determine & trigger what sound effect to play
		if (KWsMatch) {
			this.#highlightedItemFound(asin, true); //Play the highlight sound
		} else if (parseFloat(etv_min) == 0) {
			this.#zeroETVItemFound(asin, true); //Play the zeroETV sound
		} else {
			this.#regularItemFound(asin, true); //Play the regular sound
		}

		//Process the bluring
		if (BlurKWsMatch) {
			this.#blurItemFound(asin);
		}

		//Apply the filters
		this.#processNotificationFiltering(tileDOM);

		// Add new click listener for the report button
		document.querySelector("#vh-report-link-" + asin).addEventListener("click", this.#handleReportClick);

		//Add new click listener for Brenda announce:
		if (Settings.get("discord.active") && Settings.get("discord.guid", false) != null) {
			const announce = document.querySelector("#vh-announce-link-" + asin);
			announce.addEventListener("click", this.#handleBrendaClick);
		}

		//Add new click listener for the pinned button
		if (Settings.get("pinnedTab.active")) {
			const pinIcon = document.querySelector("#vh-pin-link-" + asin);
			pinIcon.addEventListener("click", this.#handlePinClick);
		}

		//Add new click listener for the hide button
		const hideIcon = document.querySelector("#vh-hide-link-" + asin);
		hideIcon.addEventListener("click", this.#handleHideClick);

		return tileDOM; //Return the DOM element for the tile.
	}

	setETV(asin, etv, processAsZeroETVFound = true) {
		const notif = this.#getNotificationByASIN(asin);

		if (!notif) {
			return false;
		}

		const etvObj = notif.querySelector(".etv");
		const brendaAnnounce = notif.querySelector("#vh-announce-link-" + asin);

		//Update the ETV value in the hidden fields
		let oldMaxValue = etvObj.dataset.etvMax; //Used to determine if a new 0ETV was found
		if (etvObj.dataset.etvMin == "" || etv < etvObj.dataset.etvMin) {
			etvObj.dataset.etvMin = etv;
		}

		if (etvObj.dataset.etvMax == "" || etv > etvObj.dataset.etvMax) {
			etvObj.dataset.etvMax = etv;
		}

		//Display for formatted ETV in the toolbar
		if (etvObj.dataset.etvMin != "" && etvObj.dataset.etvMax != "") {
			if (etvObj.dataset.etvMin == etvObj.dataset.etvMax) {
				etvObj.innerText = this.#formatETV(etvObj.dataset.etvMin);
			} else {
				etvObj.innerText =
					this.#formatETV(etvObj.dataset.etvMin) + "-" + this.#formatETV(etvObj.dataset.etvMax);
			}
		}

		//If Brenda is enabled, toggle the button display according to wether the ETV is known.
		if (brendaAnnounce) {
			if (etvObj.dataset.etvMin == "") {
				brendaAnnounce.style.visibility = "hidden";
			} else {
				brendaAnnounce.style.visibility = "visible";
			}
		}

		//Check if the item is a 0ETV
		if (processAsZeroETVFound && oldMaxValue == "" && parseFloat(etvObj.dataset.etvMin) == 0) {
			this.#zeroETVItemFound(asin);
		}
	}

	#zeroETVItemFound(asin, playSoundEffect = true) {
		const notif = this.#getNotificationByASIN(asin);

		if (!notif) {
			return false;
		}

		//Play the zero ETV sound effect
		if (playSoundEffect) {
			SoundPlayer.play(TYPE_ZEROETV);

			//Kind of sketch, but if the sound effect is on, we know the type was determined.
			notif.dataset.type = TYPE_ZEROETV;
		}

		//Highlight for ETV
		notif.style.backgroundColor = Settings.get("notification.monitor.zeroETV.color");
		if (notif.getAttribute("data-notification-type") != TYPE_HIGHLIGHT) {
			notif.setAttribute("data-notification-type", TYPE_ZEROETV);
		}

		//Move the notification to the top
		const container = document.getElementById("vvp-items-grid");
		container.insertBefore(notif, container.firstChild);
	}

	#highlightedItemFound(asin, playSoundEffect = true) {
		const notif = this.#getNotificationByASIN(asin);

		if (!notif) {
			return false;
		}

		//Play the highlight sound effect
		if (playSoundEffect) {
			SoundPlayer.play(TYPE_HIGHLIGHT);

			//Kind of sketch, but if the sound effect is on, we know the type was determined.
			notif.dataset.type = TYPE_HIGHLIGHT;
		}

		//Highlight for Highlighted item
		notif.style.backgroundColor = Settings.get("notification.monitor.highlight.color");
	}

	#regularItemFound(asin, playSoundEffect = true) {
		const notif = this.#getNotificationByASIN(asin);

		if (!notif) {
			return false;
		}

		//Play the regular notification sound effect.
		if (playSoundEffect) {
			SoundPlayer.play(TYPE_REGULAR);

			//Kind of sketch, but if the sound effect is on, we know the type was determined.
			notif.dataset.type = TYPE_REGULAR;
		}
	}

	#blurItemFound(asin) {
		const notif = this.#getNotificationByASIN(asin);

		if (!notif) {
			return false;
		}

		//Blur the thumbnail and title
		notif.querySelector(".vh-img-container>img")?.classList.add("blur");
		notif.querySelector(".vvp-item-product-title-container>a")?.classList.add("dynamic-blur");
	}

	#processNotificationFiltering(node) {
		if (!node) {
			return false;
		}

		const filterType = document.querySelector("select[name='filter-type']");
		const filterQueue = document.querySelector("select[name='filter-queue']");

		const notificationType = parseInt(node.dataset.type);
		const queueType = node.dataset.queue;

		//Feed Paused
		if (node.dataset.feedPaused == "true") {
			node.style.display = "none";
			return false;
		}

		if (filterType.value == -1) {
			node.style.display = "grid";
		} else if (filterType.value == TYPE_HIGHLIGHT_OR_ZEROETV) {
			const typesToShow = [TYPE_HIGHLIGHT, TYPE_ZEROETV];
			node.style.display = typesToShow.includes(notificationType) ? "grid" : "none";
			typesToShow.includes(notificationType);
		} else {
			node.style.display = notificationType == filterType.value ? "grid" : "none";
			notificationType == filterType.value;
		}

		if (node.style.display == "grid") {
			if (filterQueue.value == "-1") {
				return true;
			} else {
				node.style.display = queueType == filterQueue.value ? "grid" : "none";
				return queueType == filterQueue.value;
			}
		} else {
			return false;
		}
	}

	//############################################################
	//## CLICK HANDLERS

	#handleHideClick(e) {
		e.preventDefault();

		const asin = e.target.dataset.asin;

		document.querySelector("#vh-notification-" + asin).remove();
	}

	#handleBrendaClick(e) {
		e.preventDefault();

		const asin = e.target.dataset.asin;
		const queue = e.target.dataset.queue;

		let etv = document.querySelector("#vh-notification-" + asin + " .etv").dataset.etvMax;

		window.BrendaAnnounceQueue.announce(asin, etv, queue, I13n.getDomainTLD());
	}

	#handlePinClick(e) {
		e.preventDefault();

		const asin = e.target.dataset.asin;
		const isParentAsin = e.target.dataset.isParentAsin;
		const enrollmentGUID = e.target.dataset.enrollmentGuid;
		const queue = e.target.dataset.queue;
		const title = e.target.dataset.title;
		const thumbnail = e.target.dataset.thumbnail;

		PinnedList.addItem(asin, queue, title, thumbnail, isParentAsin, enrollmentGUID);

		//Display notification
		Notifications.pushNotification(
			new ScreenNotification({
				title: `Item ${asin} pinned.`,
				lifespan: 3,
				content: title,
			})
		);
	}

	#handleReportClick(e) {
		e.preventDefault(); // Prevent the default click behavior
		const asin = e.target.dataset.asin;

		let val = prompt(
			"Are you sure you want to REPORT the user who posted ASIN#" +
				asin +
				"?\n" +
				"Only report notifications which are not Amazon products\n" +
				"Note: False reporting may get you banned.\n\n" +
				"type REPORT in the field below to send a report:"
		);
		if (val !== null && val.toLowerCase() == "report") {
			this.#send_report(asin);
		}
	}

	#send_report(asin) {
		let manifest = chrome.runtime.getManifest();

		const content = {
			api_version: 5,
			app_version: manifest.version,
			country: I13n.getCountryCode(),
			action: "report_asin",
			uuid: Settings.get("general.uuid", false),
			asin: asin,
		};
		const options = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(content),
		};

		showRuntime("Sending report...");

		//Send the report to VH's server
		fetch(VINE_HELPER_API_V5_URL, options).then(function () {
			alert("Report sent. Thank you.");
		});
	}

	//#######################################################
	//## UTILITY METHODS

	#getNotificationByASIN(asin) {
		return document.querySelector("#vh-notification-" + asin);
	}

	#formatETV(etv) {
		let formattedETV = "";
		if (etv != null) {
			formattedETV = new Intl.NumberFormat(I13n.getLocale(), {
				style: "currency",
				currency: I13n.getCurrency(),
			}).format(etv);
		}
		return formattedETV;
	}

	#formatDate(date) {
		return new Date(date.replace(" ", "T") + "Z").toLocaleString(I13n.getLocale(), {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	}
}

export { NotificationMonitor };
