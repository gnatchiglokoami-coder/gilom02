/* ==========================================================
   LapinMarket – script.js
   1. STOCKAGE   : où sont enregistrées les annonces (à remplacer
                   par votre serveur / Firebase / Supabase plus tard)
   2. VENDEUR    : inscription du vendeur (profil)
   3. AFFICHAGE  : cartes, filtres, carrousel photos/vidéo
   4. FORMULAIRES: inscription et publication
   ========================================================== */

/* ---------- 1. STOCKAGE (IndexedDB, dans le navigateur) ---------- */
/* IMPORTANT : ici les annonces sont enregistrées dans le navigateur
   du visiteur seulement. Pour un site partagé entre tous les vendeurs,
   remplacez les 3 fonctions de l'objet Store (all, add, remove) par des
   appels à votre base de données en ligne. Le reste du code ne change pas. */
const DB_NAME = "lapinmarket";
const STORE_NAME = "annonces";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, mode);
    const request = fn(t.objectStore(STORE_NAME));
    t.oncomplete = () => resolve(request.result);
    t.onerror = () => reject(t.error);
  }));
}

const Store = {
  all:    ()     => tx("readonly",  s => s.getAll()),
  add:    (item) => tx("readwrite", s => s.put(item)),
  remove: (id)   => tx("readwrite", s => s.delete(id)),
};

/* ---------- 2. VENDEUR ---------- */
const SELLER_KEY = "lapinmarket_vendeur";
const getSeller = () => { try { return JSON.parse(localStorage.getItem(SELLER_KEY)); } catch { return null; } };
const saveSeller = s => localStorage.setItem(SELLER_KEY, JSON.stringify(s));

/* Convertit un numéro marocain (06…, +212…, 00212…) au format WhatsApp */
function whatsappNumber(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "228" + d.slice(1);
  return d;
}

/* ---------- Utilitaires ---------- */
const $ = (s, root = document) => root.querySelector(s);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer;
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

/* ---------- 3. AFFICHAGE ---------- */
let listings = [];
let objectUrls = [];

function buildMedia(item) {
  const box = el("div", "media");
  const slides = [
    ...(item.photos || []).map(blob => ({ type: "img", blob })),
    ...(item.video ? [{ type: "video", blob: item.video }] : []),
  ];
  if (!slides.length) {
    box.appendChild(el("div", "media-empty", "Pas de photo"));
    return box;
  }
  let i = 0;
  const show = () => {
    box.querySelectorAll("img, video, .badge-video").forEach(n => n.remove());
    const s = slides[i];
    const url = URL.createObjectURL(s.blob);
    objectUrls.push(url);
    const node = document.createElement(s.type === "img" ? "img" : "video");
    node.src = url;
    if (s.type === "img") { node.alt = item.title; node.loading = "lazy"; }
    else { node.controls = true; node.preload = "metadata"; box.prepend(el("span", "badge-video", "Vidéo")); }
    box.prepend(node);
  };
  show();
  if (slides.length > 1) {
    const prev = el("button", "nav prev", "‹"), next = el("button", "nav next", "›");
    prev.type = next.type = "button";
    prev.setAttribute("aria-label", "Média précédent");
    next.setAttribute("aria-label", "Média suivant");
    prev.onclick = () => { i = (i - 1 + slides.length) % slides.length; show(); };
    next.onclick = () => { i = (i + 1) % slides.length; show(); };
    box.append(prev, next);
  }
  return box;
}

function buildCard(item) {
  const card = el("article", "card");
  card.appendChild(buildMedia(item));

  const body = el("div", "card-body");
  const top = el("div", "card-top");
  top.append(el("h3", "", item.title), el("span", "price", item.price + " F CFA"));
  body.appendChild(top);

  const facts = el("div", "facts");
  facts.append(el("span", "fact", item.breed), el("span", "fact", item.weight + " kg"));
  if (item.age) facts.appendChild(el("span", "fact", item.age));
  facts.appendChild(el("span", "fact", item.city));
  body.appendChild(facts);

  if (item.desc) body.appendChild(el("p", "desc", item.desc));
  body.appendChild(el("p", "seller", "Vendeur : " + item.seller));

  const actions = el("div", "card-actions");
  const wa = el("a", "btn btn-sage", "Écrire sur WhatsApp");
  const msg = `Bonjour, je suis intéressé par votre annonce « ${item.title} » sur LapinMarket.`;
  wa.href = `https://wa.me/${whatsappNumber(item.wa)}?text=${encodeURIComponent(msg)}`;
  wa.target = "_blank";
  wa.rel = "noopener";
  actions.appendChild(wa);

  const me = getSeller();
  if (me && me.id === item.sellerId) {
    const del = el("button", "btn btn-ghost", "Supprimer mon annonce");
    del.type = "button";
    del.onclick = async () => {
      if (!confirm("Supprimer cette annonce ?")) return;
      await Store.remove(item.id);
      toast("Annonce supprimée");
      loadListings();
    };
    actions.appendChild(del);
  }
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function applyFilters() {
  const q = $("#q").value.trim().toLowerCase();
  const breed = $("#f-breed").value;
  const wmin = parseFloat($("#f-wmin").value);
  const wmax = parseFloat($("#f-wmax").value);
  const sort = $("#f-sort").value;

  const list = listings.filter(it =>
    (!q || [it.title, it.breed, it.city, it.seller].join(" ").toLowerCase().includes(q)) &&
    (!breed || it.breed === breed) &&
    (isNaN(wmin) || it.weight >= wmin) &&
    (isNaN(wmax) || it.weight <= wmax)
  );

  list.sort((a, b) =>
    sort === "price-asc" ? a.price - b.price :
    sort === "price-desc" ? b.price - a.price :
    sort === "weight-desc" ? b.weight - a.weight :
    b.createdAt - a.createdAt
  );

  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  $("#grid").replaceChildren(...list.map(buildCard));
  $("#empty").hidden = listings.length > 0;
}

function refreshBreedOptions() {
  const select = $("#f-breed");
  const current = select.value;
  const breeds = [...new Set(listings.map(l => l.breed))].sort((a, b) => a.localeCompare(b, "fr"));
  select.replaceChildren(new Option("Toutes les races", ""), ...breeds.map(b => new Option(b, b)));
  select.value = breeds.includes(current) ? current : "";
}

async function loadListings() {
  listings = await Store.all();
  $("#count-listings").textContent = listings.length;
  $("#count-sellers").textContent = new Set(listings.map(l => l.sellerId)).size;
  refreshBreedOptions();
  applyFilters();
}

/* ---------- 4. FORMULAIRES ---------- */
function openDialog(id) {
  const dlg = $(id);
  $("[data-error]", dlg).textContent = "";
  dlg.showModal();
}

document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

function openSellerDialog() {
  const me = getSeller();
  const form = $("#form-seller");
  if (me) { form.name.value = me.name; form.wa.value = me.wa; form.city.value = me.city; }
  openDialog("#dlg-seller");
}

function openListingDialog() {
  if (!getSeller()) { toast("Créez d’abord votre profil vendeur"); openSellerDialog(); return; }
  openDialog("#dlg-listing");
}

$("#form-seller").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, err = $("[data-error]", f);
  const name = f.name.value.trim(), city = f.city.value.trim(), wa = f.wa.value.trim();
  if (!name || !city) { err.textContent = "Renseignez votre nom et votre ville."; return; }
  if (whatsappNumber(wa).length < 9) { err.textContent = "Numéro WhatsApp invalide. Exemple : 06 12 34 56 78."; return; }
  const old = getSeller();
  saveSeller({ id: old ? old.id : crypto.randomUUID(), name, wa, city });
  $("#dlg-seller").close();
  $("#btn-account").textContent = "Mon profil";
  toast("Profil enregistré");
  loadListings();
});

$("#form-listing").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, err = $("[data-error]", f);
  const me = getSeller();
  const photos = [...f.photos.files].slice(0, 4);
  const video = f.video.files[0] || null;

  if (!f.title.value.trim() || !f.breed.value.trim()) { err.textContent = "Le titre et la race sont obligatoires."; return; }
  if (f.weight.value === "" || f.price.value === "") { err.textContent = "Indiquez le poids et le prix."; return; }
  if (video && video.size > 50 * 1048576) { err.textContent = "La vidéo dépasse 50 Mo. Choisissez un fichier plus léger."; return; }

  const submit = $("button[type=submit]", f);
  submit.disabled = true;
  try {
    await Store.add({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      sellerId: me.id, seller: me.name, wa: me.wa,
      city: me.city,
      title: f.title.value.trim(),
      breed: f.breed.value.trim(),
      weight: parseFloat(f.weight.value),
      price: parseFloat(f.price.value),
      age: f.age.value.trim(),
      desc: f.desc.value.trim(),
      photos, video,
    });
    f.reset();
    $("#dlg-listing").close();
    toast("Annonce publiée");
    loadListings();
  } catch (error) {
    err.textContent = "La publication a échoué. Réduisez la taille des fichiers et réessayez.";
  } finally {
    submit.disabled = false;
  }
});

/* ---------- Événements ---------- */
$("#btn-account").addEventListener("click", openSellerDialog);
$("#btn-add").addEventListener("click", openListingDialog);
$("#btn-add-empty").addEventListener("click", openListingDialog);
$("#hero-search").addEventListener("submit", e => { e.preventDefault(); applyFilters(); $("#grid").scrollIntoView({ behavior: "smooth" }); });
["#q", "#f-breed", "#f-wmin", "#f-wmax", "#f-sort"].forEach(s => $(s).addEventListener("input", applyFilters));

/* ---------- Démarrage ---------- */
if (getSeller()) $("#btn-account").textContent = "Mon profil";
loadListings();
