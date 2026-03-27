// Three JS Modules
import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { AnimationMixer } from "three";

// Post Processing
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// Debugging Tools
import Stats from "three/examples/jsm/libs/stats.module.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";

// Particle System File
import { getParticleSystem } from "./getParticleSystem.js";

let camera, scene, renderer, composer, controls, model;
let modelCircle, baseCircle;
let gui, guiCam;
let room; // Oda objesi
let isLocked = false; // Pointer lock durumu
let currentInteractable = null; // Şu an bakılan etkileşimli obje
let interactionHintDiv; // E tuşu ipucu elementi
window.isDoorOpen = false; // Kapı durumu
window.doorGroup = null; // Kapı objesi referansı
let handsGroup; // Procedural hands group
let scenarioDurationMs = 25000;
let nextDoorPenaltyAt = 0;
let backpackCollected = false;
let scenarioEndOverlay = null;
let roomTourStarted = false;
const safeZonesUsed = {
  bedLeft: false,
  bedRight: false,
  deskUnder: false,
  closetSide: false,
};
const SAFE_ZONE_CONFIG = {
  bedLeft: {
    label: "Yatağın Solu",
    points: 40,
    center: new THREE.Vector3(-1.8, 1.6, -4.0),
    targetPosition: new THREE.Vector3(-1.8, 1.6, -4.0),
    targetLookAt: new THREE.Vector3(-0.5, 0.6, -4.8),
  },
  bedRight: {
    label: "Yatağın Sağı",
    points: 30,
    center: new THREE.Vector3(0.8, 1.6, -4.0),
    targetPosition: new THREE.Vector3(0.8, 1.6, -4.0),
    targetLookAt: new THREE.Vector3(-0.5, 0.6, -4.8),
  },
  deskUnder: {
    label: "Masanın Altı",
    points: 60,
    center: new THREE.Vector3(5.1, 0.95, -1.65),
    targetPosition: new THREE.Vector3(5.1, 0.95, -1.65),
    targetLookAt: new THREE.Vector3(5.1, 0.95, -1.2),
  },
  closetSide: {
    label: "Dolabın Yanı",
    points: 50,
    center: new THREE.Vector3(4.6, 1.6, 1.5),
    targetPosition: new THREE.Vector3(4.6, 1.6, 1.5),
    targetLookAt: new THREE.Vector3(5.3, 1.2, 1.5),
  },
};

// Animation mixers
let mixerSmoke, mixerFE, modelFE;

// Deprem simülasyonu değişkenleri
let earthquakeEnable = false;
let shakeEnable = false;
let earthquakeIntensity = 0;
let earthquakeStage = "none";
let fallingObjectsActive = false;
let electricityOn = true;

// Partikül hızları ve oranları
let dustRateValue = 50;
let debrisRateValue = 30;
let dustSpeed = 1.0;
let debrisSpeed = 0.8;
let dustRate = 0;
let debrisRate = 0;
let dustVelocity = new THREE.Vector3(0, 0.1, 0);
let debrisVelocity = new THREE.Vector3(0, -0.1, 0);

// Yangın efektleri (depremde kullanılmıyor, ama tanımlanmalı)
let feRate = 0;
let feEnable = false;
let feVelocity = new THREE.Vector3(0, 0.2, 0);
let feSpeed = 1.0;
let feRateValue = 0;

// Particle emitters
let dustSpawn, debrisSpawn, feSpawn, fallingObjectsSpawn;

// Partikül efektleri
let dustEffect, debrisEffect, feEffect, fallingObjectsEffect;

const clock = new THREE.Clock();
let deltaTime;

// Audio placeholder
function initAudio() {
  console.log("🔊 initAudio: Ses sistemi placeholder yüklendi");
  // Gelecekte gerçek sesleri burada kurun
}

// Göz hizası sabit yüksekliği (metre cinsinden)
const EYE_HEIGHT = 1.6;

// Oda boyutu (m). Odayı belirgin şekilde büyütmek için kullanılır.
const ROOM_SIZE = 12;

// ==================== FPS HAREKET KONTROLLERİ (WASD) ====================
// Klavye ile birinci şahıs (kişi POV) hareketi için değişkenler
const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

// Hareket hızı (metre/saniye)
const moveSpeed = 2.5;

function onKeyDown(event) {
  if (scenarioEnded) return;
  switch (event.code) {
    case "KeyW":
      moveState.forward = true;
      break;
    case "KeyS":
      moveState.backward = true;
      break;
    case "KeyA":
      moveState.left = true;
      break;
    case "KeyD":
      moveState.right = true;
      break;
    case "KeyE":
      if (event.repeat) return;
      if (currentInteractable) {
        handleInteraction(currentInteractable);
      }
      break;
  }
}

// Etkileşim işleyicisi
function handleInteraction(object) {
  if (!object || scenarioEnded) return;
  if (!timerStarted) return;

  if (object.type === "door") {
    addScore(-20, "Kapı ile etkileşim cezası (-20)");
    showMessage("⚠ Sarsıntı sırasında kapıyı kullanmayın! -20 puan", 1800);
    decisionLog.push({
      time: Date.now() - startTime,
      action: "door_interaction_penalty",
      description: "Kapı ile etkileşimde ceza verildi.",
    });
    return;
  }

  if (object.type === "window") {
    addScore(-100, "Tehlikeli pencere etkileşimi (-100)");
    decisionLog.push({
      time: Date.now() - startTime,
      action: "window_interaction_fail",
      description: "Pencere ile etkileşime geçildi, senaryo başarısız.",
    });
    endScenario("ÖLDÜN", "fail_window");
    return;
  }

  if (object.type === "backpack") {
    if (!backpackCollected) {
      backpackCollected = true;
      addScore(40, "Deprem çantası alındı (+40)");
      const backpackModel = loadedModels.backpack;
      if (backpackModel && backpackModel.parent) {
        backpackModel.parent.remove(backpackModel);
      }
      decisionLog.push({
        time: Date.now() - startTime,
        action: "backpack_collected",
        description: "Deprem çantası alındı.",
      });
      showMessage("🎒 Deprem çantası alındı! +40 puan", 2000);
    }
    return;
  }

  if (object.type === "safezone") {
    const zone = SAFE_ZONE_CONFIG[object.key];
    if (!zone || safeZonesUsed[object.key]) return;

    safeZonesUsed[object.key] = true;
    addScore(zone.points, `${zone.label} güvenli alanı (+${zone.points})`);
    camera.position.copy(zone.targetPosition);
    camera.position.y = Math.max(0.6, EYE_HEIGHT - 0.8);
    camera.lookAt(zone.targetLookAt);
    showMessage(`✅ ${zone.label}: Çök-Kapan-Tut! (+${zone.points})`, 2500);
    decisionLog.push({
      time: Date.now() - startTime,
      action: `safe_zone_${object.key}`,
      description: `${zone.label} güvenli alanı seçildi.`,
    });
    endScenario("SENARYO BİTTİ", `safezone_${object.key}`);
  }
}

function toggleDoor() {
  if (!window.doorGroup) return;

  window.isDoorOpen = !window.isDoorOpen;

  // Basit rotasyon animasyonu
  if (window.isDoorOpen) {
    // Aç (İçeri veya dışarı, -90 derece diyelim)
    // Menteşe solda, içeri açılsın
    window.doorGroup.rotation.y = -Math.PI / 2;
    showMessage("🚪 Kapı Açıldı", 1000);
  } else {
    // Kapat
    window.doorGroup.rotation.y = 0;
    showMessage("🚪 Kapı Kapandı", 1000);
  }
}

function addScore(points, description) {
  userScore += points;
  decisionLog.push({
    time: Date.now() - startTime,
    action: points >= 0 ? "score_gain" : "score_loss",
    description,
  });
}

function endScenario(resultText, reason = "completed") {
  if (scenarioEnded) return;
  scenarioEnded = true;
  earthquakeEnable = false;
  shakeEnable = false;
  earthquakeStage = "stopped";
  fallingObjectsActive = false;

  const totalTime = timerStarted ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";
  const statusDiv = document.getElementById("earthquakeStatus");
  if (statusDiv) {
    statusDiv.textContent = resultText === "ÖLDÜN" ? "❌ ÖLDÜN" : "🏁 SENARYO BİTTİ";
    statusDiv.style.animation = "none";
    statusDiv.style.color = resultText === "ÖLDÜN" ? "#ff3b3b" : "#00ff00";
    statusDiv.style.borderColor = resultText === "ÖLDÜN" ? "#ff3b3b" : "#00ff00";
  }

  const timerDiv = document.getElementById("timer");
  if (timerDiv) {
    timerDiv.textContent = `🏁 Bitti | Süre: ${totalTime}s | Puan: ${userScore}`;
    timerDiv.style.color = "#00ff00";
  }

  if (!scenarioEndOverlay) {
    scenarioEndOverlay = document.createElement("div");
    scenarioEndOverlay.style.position = "fixed";
    scenarioEndOverlay.style.top = "50%";
    scenarioEndOverlay.style.left = "50%";
    scenarioEndOverlay.style.transform = "translate(-50%, -50%)";
    scenarioEndOverlay.style.background = "rgba(0,0,0,0.85)";
    scenarioEndOverlay.style.border = "2px solid #ffffff";
    scenarioEndOverlay.style.color = "#ffffff";
    scenarioEndOverlay.style.padding = "18px 28px";
    scenarioEndOverlay.style.borderRadius = "12px";
    scenarioEndOverlay.style.zIndex = "20000";
    scenarioEndOverlay.style.textAlign = "center";
    document.body.appendChild(scenarioEndOverlay);
  }

  scenarioEndOverlay.innerHTML = `
    <div style="font-size:30px;font-weight:700;margin-bottom:10px;">${resultText}</div>
    <div style="font-size:22px;">Toplam Puan: <b>${userScore}</b></div>
    <div style="font-size:16px;margin-top:8px;opacity:0.9;">Süre: ${totalTime}s</div>
    <button id="restartScenarioBtn" style="margin-top:14px;background:#4caf50;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;">
      🔄 Yeniden Başlat
    </button>
  `;
  scenarioEndOverlay.style.display = "block";
  const restartBtn = document.getElementById("restartScenarioBtn");
  if (restartBtn) restartBtn.onclick = () => window.location.reload();
  if (controls && controls.isLocked) controls.unlock();
  if (interactionHintDiv) interactionHintDiv.style.display = "none";

  decisionLog.push({
    time: Date.now() - startTime,
    action: "scenario_end",
    description: `Senaryo bitti (${reason}). Puan: ${userScore}`,
  });
}

function onKeyUp(event) {
  switch (event.code) {
    case "KeyW":
      moveState.forward = false;
      break;
    case "KeyS":
      moveState.backward = false;
      break;
    case "KeyA":
      moveState.left = false;
      break;
    case "KeyD":
      moveState.right = false;
      break;
  }
}

// Oda içi sınır için yardımcı fonksiyon (GÜNCELLENDİ: Kapı ve Dışarı Çıkış)
function clampInsideRoom(position) {
  const roomHalfSize = ROOM_SIZE / 2 - 0.1; // Yan ve arka duvarlar (iç boşluk payı)
  const wallZ = ROOM_SIZE / 2; // Ön duvar (Kapı duvarı)
  const outsideLimitZ = wallZ + 3.5; // Dışarıda gidilebilecek son nokta
  const doorHalfWidth = 0.5; // Kapı genişliğinin yarısı (1m kapı)
  const doorwayInset = 0.3; // Duvar/kapı geçiş kontrol bandı

  // X Sınırları (Oda genişliği - Dışarıda da aynı genişlikte koridor varsayalım)
  if (position.x > roomHalfSize) position.x = roomHalfSize;
  if (position.x < -roomHalfSize) position.x = -roomHalfSize;

  // Z Sınırları (Arka duvar ve Dış sınır)
  if (position.z < -roomHalfSize) position.z = -roomHalfSize;
  if (position.z > outsideLimitZ) position.z = outsideLimitZ;

  // Ön Duvar Kontrolü (Z = 2.5 civarı)
  // Eğer duvara yaklaşıyorsa
  if (position.z > wallZ - doorwayInset && position.z < wallZ + doorwayInset) {
    const inDoorway = Math.abs(position.x) < doorHalfWidth;

    if (!inDoorway) {
      // Kapı hizasında değiliz - Duvar var
      if (position.z < wallZ) position.z = wallZ - doorwayInset; // İçeride kal
      else position.z = wallZ + doorwayInset; // Dışarıda kal
    } else {
      // Kapı hizasındayız
      if (!window.isDoorOpen) {
        // Kapı kapalı - Geçiş yok
        if (position.z < wallZ) position.z = wallZ - doorwayInset;
        else position.z = wallZ + doorwayInset;
      }
      // Kapı açıksa geçebiliriz
    }
  }
}

function updateFirstPersonMovement(delta) {
  // Sadece kilitliyse (senaryo başladığında kilitleniyor) harekete izin ver
  if (scenarioEnded) return;
  if (!controls.isLocked) return;

  // Hiçbir tuşa basılmıyorsa çık
  if (
    !moveState.forward &&
    !moveState.backward &&
    !moveState.left &&
    !moveState.right
  ) {
    return;
  }

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Y eksenini sıfırla ki sadece yatay düzlemde hareket etsin
  direction.y = 0;
  direction.normalize();

  // Sağ/sol yön vektörü (strafe) - dünya yukarı ekseni ile çarpım
  const strafe = new THREE.Vector3();
  strafe.crossVectors(direction, camera.up).normalize();

  const velocity = new THREE.Vector3();

  if (moveState.forward) {
    velocity.add(direction);
  }
  if (moveState.backward) {
    velocity.sub(direction);
  }
  if (moveState.left) {
    velocity.sub(strafe);
  }
  if (moveState.right) {
    velocity.add(strafe);
  }

  if (velocity.lengthSq() === 0) return;

  velocity.normalize().multiplyScalar(moveSpeed * delta);

  // Kamera ve hedef (controls.target) birlikte taşınmalı ki FPS hissi bozulmasın
  camera.position.add(velocity);

  // Kamerayı oda içinde tut
  clampInsideRoom(camera.position);
}

// Ses sistemı
let alarmSound;

// Performans ayarları
const statsEnable = false; // FPS için istatistik panelini kapat
const guiEnable = false;
const toneMapping = THREE.ACESFilmicToneMapping;
const antialiasing = false;
const AmbientOcclusion = false;
// Masa/bilgisayar bölgesinde kasmayı azaltmak için gölge ve env yansımasını kapat
const SHADOWS_ENABLED = false;
const ENV_REFLECTION_ENABLED = false;

const loader = new GLTFLoader().setPath("/assets/3D/");
const texLoader = new THREE.TextureLoader().setPath("/assets/textures/");
const hdriLoader = new RGBELoader().setPath("/assets/hdri/");

const fileFE = "FE8.glb";
const fileBase = "circle.glb";

// ==================== GERÇEKÇİ 3D MODEL YAPILANDIRMASI ====================
// Bu modelleri assets/3D/ klasörüne indirin
// Önerilen kaynaklar: Sketchfab, Poly Pizza, CGTrader (ücretsiz bölüm)
const REALISTIC_MODELS = {
  bed: {
    file: "Bed.glb",
    // Karşı duvara (z negatif)
    position: { x: -0.5, y: 0, z: -4.2 },
    scale: { x: 1.5, y: 1.5, z: 1.5 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  closet: {
    file: "Closet.glb",
    // Sağ tarafa taşındı
    position: { x: 5.6, y: 0, z: 1.5 },
    scale: { x: 0.75, y: 0.75, z: 0.75 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 },
  },
  bookcase: {
    file: "Bookcase with Books.glb",
    // Sağ duvara yaslı
    position: { x: 5.6, y: 0, z: 0.0 },
    scale: { x: 0.7, y: 0.7, z: 0.7 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 },
  },
  window1: {
    file: "Window1 white open 1731.glb",
    // Sol duvara yaslı ve yukarıda
    position: { x: -5.6, y: 1.6, z: 0.0 },
    scale: { x: 0.65, y: 0.65, z: 0.65 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 },
  },
  ceilingLight: {
    file: "Light Ceiling.glb",
    position: { x: 0, y: 2.8, z: 0 },
    scale: { x: 1.0, y: 1.0, z: 1.0 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  orchid: {
    file: "Orchid.glb",
    // Sol arka köşe: çiçek çok büyük olmasın
    position: { x: -4.95, y: 0, z: -4.75 },
    scale: { x: 0.25, y: 0.25, z: 0.25 },
    rotation: { x: 0, y: -Math.PI / 4, z: 0 },
  },
  glass: {
    file: "Glass.glb",
    // Bardak: bilgisayarın yanında
    position: { x: 5.5, y: 1.1, z: -1.25 },
    scale: { x: 0.11, y: 0.11, z: 0.11 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  wallPainting: {
    file: "Wall painting.glb",
    // Yatağın olduğu duvarda, yatağın sağında
    position: { x: 2, y: 1.45, z: -5.5 },
    scale: { x: 0.1, y: 0.1, z: 0.1 },
    rotation: { x: 0, y: Math.PI + Math.PI / 2, z: 0 },
  },
  smashedGlass: {
    file: "Smashed Glass.glb",
    // Cam kırıkları bardak yakınında, yere yakın
    position: { x: 4.6, y: 0, z: -1 },
    scale: { x: 0.3, y: 0.3, z: 0.3 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  rug: {
    file: "Modern rug.glb",
    // Odanın ortasında, zemine yakın modern halı
    position: { x: 0, y: 0.01, z: 0 },
    scale: { x: 0.6, y: 0.6, z: 0.6 },
    rotation: { x: 0, y: Math.PI + Math.PI / 2, z: 0 },
  },
  officeChair: {
    file: "Office Chair-2.glb",
    // Masanın yanında, oda içinde daha görünür konum
    position: { x: 4.6, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: Math.PI, z: 0 },
  },
  // istersen eski objeler de kalabilir hatta simülasyona katılabilir
  desk: {
    file: "Desk.glb",
    // Sağ duvara yaslı ve daha büyük
    position: { x: 5.45, y: 0, z: -1.65 },
    scale: { x: 1.0, y: 1.0, z: 1.0 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 },
  },
  computer: {
    file: "Profesional PC.glb",
    // Masanın üstünde (sağ duvar)
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 5, y: 5, z: 5 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
  },
  backpack: {
    file: "Backpack.glb",
    // Masanın yanında, görünür alanda
    position: { x: 5.7, y: 0.4, z: -3 },
    scale: { x: 2, y: 2, z: 2 },
    rotation: { x: 0, y: Math.PI , z: 0 },
  },
};

// Yüklenen modelleri saklayacak obje
const loadedModels = {};
let modelsLoaded = false;

// Model yükleme fonksiyonu - Promise tabanlı
function loadModel(modelKey) {
  return new Promise((resolve, reject) => {
    const config = REALISTIC_MODELS[modelKey];
    if (!config) {
      reject(new Error(`Model config not found: ${modelKey}`));
      return;
    }

    loader.load(
      // Dosya adlarında boşluk olabileceği için (örn: "Office Chair.glb")
      // URL'yi encode ederek 404 yükleme hatalarını engelliyoruz.
      encodeURI(config.file),
      (gltf) => {
        const model = gltf.scene;
        model.position.set(
          config.position.x,
          config.position.y,
          config.position.z
        );
        model.scale.set(config.scale.x, config.scale.y, config.scale.z);
        model.rotation.set(
          config.rotation.x,
          config.rotation.y,
          config.rotation.z
        );

        // Gölge ayarları
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.userData.interactableKey = modelKey;
          }
        });

        loadedModels[modelKey] = model;
        console.log(`✓ Model yüklendi: ${modelKey}`);
        resolve(model);
      },
      (progress) => {
        // Yükleme ilerleme
      },
      (error) => {
        console.warn(
          `⚠ Model yüklenemedi: ${modelKey} - Fallback kullanılacak`
        );
        resolve(null); // Hata durumunda null döndür, reject yapma
      }
    );
  });
}

// Tüm modelleri yükle
async function loadAllRealisticModels() {
  console.log("📦 Gerçekçi modeller yükleniyor...");

  const modelKeys = Object.keys(REALISTIC_MODELS);
  const loadPromises = modelKeys.map((key) => loadModel(key));

  await Promise.all(loadPromises);

  modelsLoaded = true;
  console.log("✅ Model yükleme tamamlandı!");

  return loadedModels;
}

let velocityRotation = new THREE.Vector3();


// Zamanlama ve puanlama
let timerStarted = false;
let alarmResponseTime = 0;
let startTime = 0;
let userScore = 0;
let decisionLog = [];

// Senaryo bitti mi (başarı veya başarısızlık)?
let scenarioEnded = false;


const cubeGeometry = new THREE.BoxGeometry();
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });


// -------------------- GUI --------------------

const guiObject = {
  earthquakeBoolean: true, // Deprem aktif olduğunda göster
  shakeBoolean: true, // Sallanma aktif olduğunda göster
  feBoolean: false, // Yangın söndürücü başlangıçta kapalı
  pauseBoolean: false,
  value1: 1,
  value2: 1,
  value3: 1.55, // Sahne parlaklığı (gölge/env kapalıyken daha aydınlık)
  value4: 0.05,
  color: { r: 0.01, g: 0.01, b: 0.01 },
};

if (typeof addGUI === "function") {
  addGUI();
} else {
  console.warn("addGUI fonksiyonu tanımlı değil. GUI atlandı.");
}

async function initApp() {
  await init();
  createProceduralHands();
  animate();
}

async function init() {
  // ------------------- Scene Setup -----------------------

  const container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.set(0, 1.6, 2.0); // Oda içinde, kapının biraz önünde başla

  // Ses sistemini başlat
  initAudio();

  // Sahne ve debug yardımcılar
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x444444);

  const grid = new THREE.GridHelper(6, 12);
  scene.add(grid);
  const axes = new THREE.AxesHelper(1.5);
  scene.add(axes);

  // Test için basit küp (kırmızı) - kaldırıldı

  // Particle emitters
  dustSpawn = new THREE.Object3D();
  debrisSpawn = new THREE.Object3D();
  feSpawn = new THREE.Object3D();
  fallingObjectsSpawn = new THREE.Object3D();

  // -------------------- Particles --------------------

  dustEffect = getParticleSystem({
    camera,
    emitter: dustSpawn,
    parent: scene,
    rate: dustRate,
    texture: "./assets/img/smoke.png",
    radius: 0.15, // Daha dar alan - daha az parçacık ekranı kaplar
    maxLife: 1.4, // Daha kısa yaşam süresi
    maxSize: 3.5, // Biraz daha küçük partiküller
    maxVelocity: dustVelocity,
    colorA: new THREE.Color(0xaaaaaa), // Gri
    colorB: new THREE.Color(0xdddddd), // Açık gri
    alphaMax: 1.0,
  });

  debrisEffect = getParticleSystem({
    camera,
    emitter: debrisSpawn,
    parent: scene,
    rate: debrisRate,
    texture: "./assets/img/smoke.png",
    radius: 0.18, // Daha dar duman alanı
    maxLife: 2.5, // Daha kısa yaşam süresi
    maxSize: 4, // Daha küçük duman partikülleri
    maxVelocity: debrisVelocity,
    colorA: new THREE.Color(0x666666), // Koyu gri
    colorB: new THREE.Color(0xbbbbbb), // Açık gri
    alphaMax: 0.8,
  });

  feEffect = getParticleSystem({
    camera,
    emitter: feSpawn,
    parent: scene,
    rate: feRate,
    texture: "./assets/img/smoke.png",
    radius: 0.05,
    maxLife: 0.8,
    maxSize: 3, // Daha büyük - yakından görünsün
    maxVelocity: feVelocity,
    colorA: new THREE.Color(0xffffff),
    colorB: new THREE.Color(0xcccccc),
    alphaMax: 0.8,
  });

  // Düşen nesneler efekti (gelişmiş aşamada)
  fallingObjectsEffect = getParticleSystem({
    camera,
    emitter: fallingObjectsSpawn,
    parent: scene,
    rate: 0, // Başlangıçta kapalı
    texture: "./assets/img/smoke.png",
    radius: 0.11,
    maxLife: 1.0,
    maxSize: 1.4,
    maxVelocity: new THREE.Vector3(0, -0.3, 0),
    colorA: new THREE.Color(0x888888), // Gri
    colorB: new THREE.Color(0xcccccc), // Açık gri
    alphaMax: 1.0,
  });

  // -------------------- Oda Oluştur --------------------

  await createRoom();

  // -------------------- Import Assets --------------------

  // Circle - KALDIRILDI (zemindeki siyah alan istenmiyor)
  // loader.load(fileBase, async function (gltf) {
  //   modelCircle = gltf.scene;
  //   modelCircle.traverse((child) => {
  //     if (child.isMesh) {
  //       child.castShadow = false;
  //       child.receiveShadow = true;
  //       child.material.renderOrder = 0;
  //       child.material.depthWrite = true;
  //       child.material.transparent = false;
  //       child.material.color = new THREE.Color(
  //         guiObject.color.r,
  //         guiObject.color.g,
  //         guiObject.color.b
  //       );
  //       baseCircle = child;
  //     }
  //   });
  //   await renderer.compileAsync(modelCircle, camera, scene);
  //   scene.add(modelCircle);
  // });

  hdriLoader.load("Env.hdr", function (texture) {
    if (!ENV_REFLECTION_ENABLED) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
  });
  if (!ENV_REFLECTION_ENABLED) scene.environment = null;

  // Oda için basit bir arka plan rengi
  scene.background = new THREE.Color(0x87ceeb); // Açık mavi gökyüzü rengi
  scene.fog = new THREE.Fog(0x87ceeb, 8, 20); // Hava perspektifi için sis

  // ------------------- Render Starts --------------------------------

  renderer = new THREE.WebGLRenderer({ antialias: antialiasing });
  // Yüksek DPI ekranlarda FPS'i korumak için piksel oranını sınırla
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);

  // ---------------------------- Mouse İnteraction --------------------------------

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseClick(event) {
    // Mouse click artık sadece pointer lock için kullanılıyor
    // Etkileşimler 'E' tuşu ile yapılıyor
  }

  // Tıklama ile kilitleme mantığı - Sadece UI interaksiyonu yoksa ve oyun başladıysa
  // Sadece senaryo başladıysa (timerStarted true ise) kilitle
  document.addEventListener("click", function (event) {
    // Kontrol ekranı açıksa kilitleme yapma
    const controlsIntro = document.getElementById("controls-intro");
    if (controlsIntro && controlsIntro.style.display !== "none") {
      return;
    }

    // Senaryo başlamadıysa kilitleme yapma
    if (!timerStarted) return;

    // Eğer bir UI elementine tıklanmadıysa ve kontroller kilitli değilse kilitle
    if (!controls.isLocked && event.target.tagName !== "BUTTON") {
      controls.lock();
    }
  });

  // ---------------------------- controls --------------------------------

  controls = new PointerLockControls(camera, document.body);

  controls.addEventListener('lock', function () {
    isLocked = true;
    // İsteğe bağlı: UI elementlerini gizle veya "Oyun Aktif" mesajı göster
  });

  controls.addEventListener('unlock', function () {
    isLocked = false;
    // İsteğe bağlı: Duraklatma menüsü göster
  });

  // OrbitControls ayarları kaldırıldı

  // FPS hareketi için klavye dinleyicileri
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // ---------------------------- scene --------------------------------

  window.addEventListener("resize", onWindowResize);

  // Aydınlatma Sistemi (gölge/env kapalıyken ortamı aydınlatmak için güçlendirildi)

  // Normal ofis aydınlatması (elektrik varken)
  window.mainLights = new THREE.Group();

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  ambientLight.name = "mainAmbient";
  window.mainLights.add(ambientLight);

  // Gökyüzü/zemin dolgu ışığı (env map yokken eşyaları aydınlatır)
  const hemiLight = new THREE.HemisphereLight(0xe8f4fc, 0x8b7355, 0.55);
  hemiLight.name = "mainHemisphere";
  window.mainLights.add(hemiLight);

  const ceilingLight1 = new THREE.PointLight(0xffffee, 2.2, 10);
  ceilingLight1.position.set(-1, 2.8, -1);
  ceilingLight1.castShadow = true;
  window.mainLights.add(ceilingLight1);

  const ceilingLight2 = new THREE.PointLight(0xffffee, 2.2, 10);
  ceilingLight2.position.set(1, 2.8, 1);
  ceilingLight2.castShadow = true;
  window.mainLights.add(ceilingLight2);

  const fillDir = new THREE.DirectionalLight(0xffffff, 0.85);
  fillDir.position.set(2, 4, 2);
  fillDir.name = "mainFillDir";
  window.mainLights.add(fillDir);

  scene.add(window.mainLights);

  // Acil Durum Aydınlatması (sadece elektrik kesilince)
  window.emergencyLights = new THREE.Group();

  const emergencyAmbient = new THREE.AmbientLight(0xff4444, 0.25);
  emergencyAmbient.name = "emergencyAmbient";
  window.emergencyLights.add(emergencyAmbient);

  const emergencyFill = new THREE.AmbientLight(0xffffff, 0.6);
  emergencyFill.name = "emergencyFill";
  window.emergencyLights.add(emergencyFill);

  // Acil durum lambaları (kırmızı)
  const emergencyPositions = [
    [-2, 2.9, -2],
    [2, 2.9, -2],
    [-2, 2.9, 2],
    [2, 2.9, 2],
  ];

  emergencyPositions.forEach((pos, index) => {
    const emergencyLight = new THREE.PointLight(0xff0000, 1.1, 6);
    emergencyLight.position.set(pos[0], pos[1], pos[2]);
    emergencyLight.name = `emergency${index}`;
    window.emergencyLights.add(emergencyLight);

    // Görsel lamba kutusu
    const lampGeometry = new THREE.BoxGeometry(0.15, 0.08, 0.15);
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.copy(emergencyLight.position);
    // room.add(lamp); // Oda içi boşaltıldı
  });

  window.emergencyLights.visible = false; // Başlangıçta kapalı
  scene.add(window.emergencyLights);

  // --------------------------------- post --------------------------------

  // Gölge haritaları (masa/bilgisayar bölgesinde performansı düşürüyor)
  renderer.shadowMap.enabled = SHADOWS_ENABLED;
  if (SHADOWS_ENABLED) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Set up post-processing
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); // ensure pixel ratio is always 1 for performance reasons

  // Create and add render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Create and add bloom pass
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.05,
    0.7,
    0.4
  );
  composer.addPass(bloomPass);

  if (AmbientOcclusion) {
    const ssaoPass = new SSAOPass(scene, camera);
    ssaoPass.kernelRadius = 0.01; // Adjust for effect strength
    ssaoPass.minDistance = 0.0001; // Minimum distance for AO
    ssaoPass.maxDistance = 0.1; // Maximum distance for AO
    composer.addPass(ssaoPass);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);

  composer.setSize(window.innerWidth, window.innerHeight); // Update composer size

  // Resize sonrası yeniden çizim yap (render() fonksiyonu yoktu).
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

function playFeAnimations() {
  FEAnimations.forEach((clip3) => {
    console.log("clip3: ", clip3);
    clip3.loop = false;
    mixerFE.clipAction(clip3).play();
  });
}

function stopFeAnimations() {
  FEAnimations.forEach((clip3) => {
    console.log("clip3: ", clip3);
    clip3.loop = false;
    mixerFE.clipAction(clip3).stop();
  });
}

// ----------------- Oda Fonksiyonu ------------------------

async function createRoom() {
  room = new THREE.Group();

  const roomSize = ROOM_SIZE;
  const wallHeight = 3;
  const wallThickness = 0.1;

  // Malzemeler
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x99C2DE,
    roughness: 0.9,
    metalness: 0.05,
  });

  // Parke desenini dış texture dosyası olmadan CanvasTexture ile üret
  function createParquetTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Deterministik küçük rasgelelik (aynı tile her çalıştırmada aynı görünsün)
    const hash = (x, y) => {
      let h = x * 374761393 + y * 668265263; // integer karıştırma
      h = (h ^ (h >> 13)) * 1274126177;
      return ((h ^ (h >> 16)) >>> 0) / 4294967295;
    };

    // Arka plan (açık meşe tonu)
    ctx.fillStyle = "#7a5a3a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cell = 64; // tile hücresi (metre değil, UV karşılığı)
    const plankW = 10; // parke plank genişliği (px)
    const seam = 2; // aralıklardaki derz kalınlığı (px)

    for (let cy = -1; cy <= canvas.height / cell + 1; cy++) {
      for (let cx = -1; cx <= canvas.width / cell + 1; cx++) {
        const px = cx * cell;
        const py = cy * cell;

        const even = (cx + cy) % 2 === 0;
        ctx.save();
        ctx.translate(px + cell / 2, py + cell / 2);
        ctx.rotate(even ? 0 : Math.PI / 2);
        ctx.translate(-cell / 2, -cell / 2);

        // Hücre içini planklarla doldur
        for (let s = -cell / 2; s < cell; s += plankW + seam) {
          const r = hash(cx, cy + s);
          const woodA = 120 + r * 40; // renk varyasyonu
          const woodB = 85 + r * 25;

          ctx.fillStyle = `rgb(${woodA}, ${woodB}, 60)`;
          ctx.fillRect(s, 0, plankW, cell);

          // Derz çizgisi
          ctx.fillStyle = "rgba(60, 40, 20, 0.65)";
          ctx.fillRect(s + plankW, 0, seam, cell);
        }

        // Kenar gölgesi (hafif derinlik hissi)
        ctx.strokeStyle = "rgba(20, 10, 0, 0.25)";
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, cell, cell);
        ctx.restore();
      }
    }

    // Hafif netlik / kir efekti
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    // Zemin boyutuna göre tekrar sayısı
    tex.repeat.set(2.2, 2.2);
    return tex;
  }

  const parquetTexture = createParquetTexture();
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: parquetTexture || undefined,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.02,
  });

  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.95,
    metalness: 0.02,
  });

  // Zemin
  const floorGeometry = new THREE.BoxGeometry(
    roomSize,
    wallThickness,
    roomSize
  );
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = -wallThickness / 2;
  floor.receiveShadow = true;
  room.add(floor);

  // Tavan
  const ceilingGeometry = new THREE.BoxGeometry(
    roomSize,
    wallThickness,
    roomSize
  );
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.y = wallHeight;
  ceiling.receiveShadow = true;
  room.add(ceiling);

  // Arka duvar
  const backWallGeometry = new THREE.BoxGeometry(
    roomSize,
    wallHeight,
    wallThickness
  );
  const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
  backWall.position.set(0, wallHeight / 2, -roomSize / 2);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  room.add(backWall);

  // Sol duvar
  const leftWallGeometry = new THREE.BoxGeometry(
    wallThickness,
    wallHeight,
    roomSize
  );
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-roomSize / 2, wallHeight / 2, 0);
  leftWall.receiveShadow = true;
  leftWall.castShadow = true;
  room.add(leftWall);

  // Sağ duvar
  const rightWallGeometry = new THREE.BoxGeometry(
    wallThickness,
    wallHeight,
    roomSize
  );
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(roomSize / 2, wallHeight / 2, 0);
  rightWall.receiveShadow = true;
  rightWall.castShadow = true;
  room.add(rightWall);

  // Ön Duvar (Kapılı)
  // Kapı boşluğu: x= -0.5 ile 0.5 arası (1m genişlik), Yükseklik 2.2m

  // Sol Parça (İçeriden bakınca sağ, x > 0.5)
  const frontRightGeo = new THREE.BoxGeometry(
    roomSize / 2 - 0.5,
    wallHeight,
    wallThickness
  );
  const frontRight = new THREE.Mesh(frontRightGeo, wallMaterial);
  frontRight.position.set(
    roomSize / 4 + 0.25,
    wallHeight / 2,
    roomSize / 2
  );
  frontRight.castShadow = true;
  frontRight.receiveShadow = true;
  room.add(frontRight);

  // Sağ Parça (İçeriden bakınca sol, x < -0.5)
  const frontLeftGeo = new THREE.BoxGeometry(
    roomSize / 2 - 0.5,
    wallHeight,
    wallThickness
  );
  const frontLeft = new THREE.Mesh(frontLeftGeo, wallMaterial);
  frontLeft.position.set(
    -(roomSize / 4 + 0.25),
    wallHeight / 2,
    roomSize / 2
  );
  frontLeft.castShadow = true;
  frontLeft.receiveShadow = true;
  room.add(frontLeft);

  // Üst Parça (Kapı üstü)
  const doorHeight = 2.2;
  const frontTopGeo = new THREE.BoxGeometry(1.0, wallHeight - doorHeight, wallThickness);
  const frontTop = new THREE.Mesh(frontTopGeo, wallMaterial);
  frontTop.position.set(0, doorHeight + (wallHeight - doorHeight) / 2, roomSize / 2);
  frontTop.castShadow = true;
  frontTop.receiveShadow = true;
  room.add(frontTop);

  // KAPI (assets/3D/Door.glb ile - prosedürel kapı kaldırıldı)
  const doorWidth = 1.0;

  // Pivot noktası için grup (Menteşe solda olsun, kapı boşluğunda)
  const doorGroup = new THREE.Group();
  doorGroup.position.set(
    -0.5,
    doorHeight / 2 - 2,
    roomSize / 2 - wallThickness / 2
  ); // Menteşe noktası (duvarın iç yüzüne hizalı)

  doorGroup.name = "DoorGroup";
  room.add(doorGroup);
  window.doorGroup = doorGroup;

  // Kapı modelini yükle ve kapı boşluğuna yerleştir
  try {
    const doorModel = await new Promise((resolve, reject) => {
      loader.load(
        "Door.glb",
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => reject(err)
      );
    });

    // Kutu kapı ile aynı yerleşim mantığı (hinge x=-0.5 olacak şekilde)
    doorModel.position.set(doorWidth - 1, 0.6, 0);
    doorModel.scale.set(0.6, 0.6, 0.6);
    doorModel.rotation.set(0, Math.PI, 0);

    // Raycaster / etkileşim için mesh isimlerini sabitle
    doorModel.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.name = "Door";
      }
    });

    doorGroup.add(doorModel);
  } catch (err) {
    console.warn("⚠ Door.glb yüklenemedi:", err);
  }

  // Acil çıkış tabelası (GLB): Kapının tam üstünde, odanın içinde (duvara sabit)
  if (false) {
    loader.load(
      "exit_box.glb",
      (gltf) => {
        const exitSign = gltf.scene;

        exitSign.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Konum: kapı boşluğunun tam üstü, ön duvarın iç yüzeyi
        // Kapı üstüne daha yakın ve biraz daha büyük
        exitSign.position.set(
          0,
          doorHeight + 0.15,
          roomSize / 2 - wallThickness / 2 - 0.01
        );

        // Ölçek: biraz daha büyük
        exitSign.scale.set(0.65, 0.65, 0.65);

        // Duvara paralel olsun (90°)
        exitSign.rotation.y = Math.PI / 2;

        room.add(exitSign);
      },
      undefined,
      (error) => {
        console.warn("⚠ exit_box.glb yüklenemedi:", error);
      }
    );
  }

  // Dış Zemin (Balkon/Koridor)
  const outFloorGeo = new THREE.BoxGeometry(roomSize, wallThickness, 4.0);
  const outFloorMat = new THREE.MeshStandardMaterial({ color: 0x333333 }); // Beton zemin
  const outFloor = new THREE.Mesh(outFloorGeo, outFloorMat);
  outFloor.position.set(0, -wallThickness / 2, roomSize / 2 + 2.0);
  outFloor.receiveShadow = true;
  room.add(outFloor);

  // ==================== GERÇEKÇİ MODELLER ====================
  // Önce modelleri yükle, ardından sadece mevcut assetleri odaya ekle
  await loadAllRealisticModels();

  const addIfLoaded = (key) => {
    const obj = loadedModels[key];
    if (obj) room.add(obj);
  };

  addIfLoaded("bed");
  addIfLoaded("closet");
  addIfLoaded("bookcase");
  addIfLoaded("window1");
  // Pencere iç yüzü için düz renk panel
  const windowInnerPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 2.0),
    new THREE.MeshStandardMaterial({
      color: 0x278EF5,
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  windowInnerPanel.position.set(-5.7, 1.65, 0.0);
  windowInnerPanel.rotation.set(0, Math.PI / 2, 0);
  windowInnerPanel.userData.interactableKey = "window1";
  room.add(windowInnerPanel);
  // Panelin üstüne sarı yuvarlak
  const windowInnerCircle = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  windowInnerCircle.position.set(-5.69, 2.1, -0.4);
  windowInnerCircle.rotation.set(0, Math.PI / 2, 0);
  windowInnerCircle.userData.interactableKey = "window1";
  room.add(windowInnerCircle);

  addIfLoaded("ceilingLight");
  addIfLoaded("wallPainting");
  addIfLoaded("rug");
  addIfLoaded("orchid");
  addIfLoaded("glass");
  addIfLoaded("officeChair");
  addIfLoaded("desk");
  addIfLoaded("computer");
  addIfLoaded("backpack");

  // Deprem partikülleri için spawn noktası
  dustSpawn.position.set(0, 1, 0);
  debrisSpawn.position.set(0, 2, 0);

  scene.add(room);
}

// ==================== FALLBACK FONKSİYONLARI ====================
// Model yüklenemezse kullanılacak basit geometriler

function createFallbackDesk() {
  // Masa üstü
  const deskGeometry = new THREE.BoxGeometry(1.5, 0.05, 0.8);
  const deskMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c4033,
    roughness: 0.7,
    metalness: 0.1,
  });
  const desk = new THREE.Mesh(deskGeometry, deskMaterial);
  desk.position.set(0, 0.75, 0);
  desk.castShadow = true;
  desk.receiveShadow = true;
  room.add(desk);

  // Masa Bacakları
  const legGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.72, 12);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.4,
    metalness: 0.6,
  });

  const positions = [
    [-0.68, 0.36, -0.35],
    [0.68, 0.36, -0.35],
    [-0.68, 0.36, 0.35],
    [0.68, 0.36, 0.35],
  ];

  positions.forEach((pos) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(pos[0], pos[1], pos[2]);
    leg.castShadow = true;
    room.add(leg);
  });

  console.log("⚠ Fallback masa kullanıldı");
}

// Procedural Hands (Three.js Primitives)
function createProceduralHands() {
  handsGroup = new THREE.Group();

  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0ac69, // Skin tone
    roughness: 0.6,
    metalness: 0.05
  });

  const createHand = (isRight) => {
    const handGroup = new THREE.Group();
    const side = isRight ? 1 : -1;

    // Arm (Forearm)
    const armGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.5, 12);
    const arm = new THREE.Mesh(armGeo, skinMaterial);
    arm.rotation.x = Math.PI / 2 - 0.2;
    arm.position.set(0.25 * side, -0.35, -0.15);
    handGroup.add(arm);

    // Palm
    const palmGeo = new THREE.BoxGeometry(0.1, 0.03, 0.12);
    const palm = new THREE.Mesh(palmGeo, skinMaterial);
    palm.position.set(0.25 * side, -0.28, -0.42);
    palm.rotation.x = -0.1;
    handGroup.add(palm);

    // Fingers
    const fingerGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(fingerGeo, skinMaterial);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(
        (0.25 * side) + (i * 0.025 - 0.0375) * side,
        -0.27,
        -0.49
      );
      handGroup.add(finger);
    }

    // Thumb
    const thumb = new THREE.Mesh(fingerGeo, skinMaterial);
    thumb.rotation.x = Math.PI / 2;
    thumb.rotation.y = side * 0.5;
    thumb.position.set(
      (0.25 * side) - (0.06 * side),
      -0.28,
      -0.44
    );
    handGroup.add(thumb);

    return handGroup;
  };

  handsGroup.add(createHand(false)); // Left
  handsGroup.add(createHand(true));  // Right

  camera.add(handsGroup);
}

function createFallbackAlarmButton() {
  // GİRİŞE YAKIN - Sol duvar (x=-2.4, z=1.8)
  const alarmX = -2.4;
  const alarmY = 1.4;
  const alarmZ = 1.8;

  // Alarm arka kutusu
  const alarmBackGeometry = new THREE.BoxGeometry(0.08, 0.35, 0.35); // Döndürüldü
  const alarmBackMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.2,
  });
  const alarmBack = new THREE.Mesh(alarmBackGeometry, alarmBackMaterial);
  alarmBack.position.set(alarmX, alarmY, alarmZ);
  alarmBack.castShadow = true;
  room.add(alarmBack);

  // Alarm butonu (kırmızı - basılabilir)
  const alarmButtonGeometry = new THREE.CylinderGeometry(0.1, 0.11, 0.06, 32);
  const alarmButtonMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
  });
  const alarmButton = new THREE.Mesh(alarmButtonGeometry, alarmButtonMaterial);
  alarmButton.position.set(alarmX + 0.07, alarmY, alarmZ); // Duvardan dışarı
  alarmButton.rotation.z = Math.PI / 2; // Yatay - sağa baksın
  alarmButton.name = "alarmBox";
  alarmButton.castShadow = true;
  room.add(alarmButton);

  // Alarm kutu çerçevesi (kırmızı çizgi)
  const frameGeometry = new THREE.BoxGeometry(0.02, 0.37, 0.37); // Döndürüldü
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    roughness: 0.4,
    metalness: 0.6,
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.set(alarmX + 0.02, alarmY, alarmZ);
  room.add(frame);

  // "ALARM" yazısı plakası
  const textGeometry = new THREE.BoxGeometry(0.02, 0.06, 0.3); // Döndürüldü
  const textMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0x440000,
    emissiveIntensity: 0.4,
  });
  const textPlate = new THREE.Mesh(textGeometry, textMaterial);
  textPlate.position.set(alarmX + 0.02, alarmY + 0.22, alarmZ);
  room.add(textPlate);

  console.log("⚠ Fallback alarm butonu kullanıldı");
}

function createFallbackTrashCan() {
  // Isıtıcı (Masa altında) - Yangın kaynağı, orijinal gri metal görünüm
  const trashCanGeometry = new THREE.CylinderGeometry(0.16, 0.19, 0.38, 20);
  const trashCanMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e6e6e,
    roughness: 0.55,
    metalness: 0.35,
  });
  const trashCan = new THREE.Mesh(trashCanGeometry, trashCanMaterial);
  trashCan.position.set(0.35, 0.19, 0.15);
  trashCan.castShadow = true;
  trashCan.receiveShadow = true;
  trashCan.name = "trashcan";
  room.add(trashCan);

  // Isıtıcı kovası kenar bandı
  const rimGeometry = new THREE.TorusGeometry(0.17, 0.015, 8, 24);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x505050,
    roughness: 0.4,
    metalness: 0.6,
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.position.set(0.35, 0.38, 0.15);
  rim.rotation.x = Math.PI / 2;
  room.add(rim);

  // Deprem spawn pozisyonunu güncelle - oda içinde
  dustSpawn.position.set(0, 1, 0);
  debrisSpawn.position.set(0, 2, 0);

  console.log("⚠ Fallback çöp kovası kullanıldı");
  return trashCan;
}

function createFallbackMonitor() {
  // Monitör
  const monitorGeometry = new THREE.BoxGeometry(0.55, 0.38, 0.04);
  const monitorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.2,
    metalness: 0.7,
  });
  const monitor = new THREE.Mesh(monitorGeometry, monitorMaterial);
  monitor.position.set(0, 0.98, -0.18);
  monitor.rotation.x = -0.08;
  monitor.castShadow = true;
  monitor.receiveShadow = true;
  monitor.name = "monitor";
  room.add(monitor);

  // Monitör ekranı (mavi - açık)
  const screenGeometry = new THREE.BoxGeometry(0.5, 0.32, 0.01);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a8cff,
    emissive: 0x0055aa,
    emissiveIntensity: 0.6,
    roughness: 0.05,
    metalness: 0.1,
  });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.set(0, 0.98, -0.155);
  screen.rotation.x = -0.08;
  room.add(screen);

  // Monitör standı - boyun
  const neckGeometry = new THREE.BoxGeometry(0.06, 0.15, 0.06);
  const standMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.6,
  });
  const neck = new THREE.Mesh(neckGeometry, standMaterial);
  neck.position.set(0, 0.855, -0.18);
  room.add(neck);

  // Monitör standı - taban
  const baseGeometry = new THREE.CylinderGeometry(0.12, 0.14, 0.02, 24);
  const base = new THREE.Mesh(baseGeometry, standMaterial);
  base.position.set(0, 0.785, -0.18);
  room.add(base);

  // Klavye
  const keyboardGeometry = new THREE.BoxGeometry(0.42, 0.015, 0.14);
  const keyboardMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.6,
    metalness: 0.3,
  });
  const keyboard = new THREE.Mesh(keyboardGeometry, keyboardMaterial);
  keyboard.position.set(0, 0.785, 0.12);
  keyboard.castShadow = true;
  keyboard.name = "keyboard";
  room.add(keyboard);

  // Mouse
  const mouseGeometry = new THREE.BoxGeometry(0.055, 0.025, 0.095);
  const mouseMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4,
    metalness: 0.4,
  });
  const computerMouse = new THREE.Mesh(mouseGeometry, mouseMaterial);
  computerMouse.position.set(0.28, 0.79, 0.15);
  computerMouse.castShadow = true;
  room.add(computerMouse);

  console.log("⚠ Fallback monitör/klavye/mouse kullanıldı");

  return { monitor, screen, keyboard, mouse: computerMouse };
}

function createFallbackChair() {
  // Basit ofis sandalyesi
  const chairGroup = new THREE.Group();

  // Oturma yeri
  const seatGeometry = new THREE.BoxGeometry(0.45, 0.06, 0.45);
  const seatMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    metalness: 0.1,
  });
  const seat = new THREE.Mesh(seatGeometry, seatMaterial);
  seat.position.y = 0.45;
  chairGroup.add(seat);

  // Sırt dayama
  const backGeometry = new THREE.BoxGeometry(0.42, 0.5, 0.05);
  const back = new THREE.Mesh(backGeometry, seatMaterial);
  back.position.set(0, 0.73, -0.2);
  back.rotation.x = 0.1;
  chairGroup.add(back);

  // Merkez ayak
  const legGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.25, 12);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.3,
    metalness: 0.8,
  });
  const centerLeg = new THREE.Mesh(legGeometry, legMaterial);
  centerLeg.position.y = 0.3;
  chairGroup.add(centerLeg);

  // 5 tekerlekli ayak
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const wheelLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8),
      legMaterial
    );
    wheelLeg.position.set(Math.cos(angle) * 0.18, 0.08, Math.sin(angle) * 0.18);
    wheelLeg.rotation.z = (Math.PI / 6) * (angle > Math.PI ? 1 : -1);
    chairGroup.add(wheelLeg);

    // Tekerlek
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    );
    wheel.position.set(Math.cos(angle) * 0.25, 0.015, Math.sin(angle) * 0.25);
    wheel.rotation.z = Math.PI / 2;
    chairGroup.add(wheel);
  }

  chairGroup.position.set(0, 0, 0.9);
  chairGroup.rotation.y = Math.PI + 0.2;
  room.add(chairGroup);

  console.log("⚠ Fallback sandalye kullanıldı");
}

// Yangın Söndürücüler Oluştur - Gerçekçi modeller
function createExtinguishers() {
  // ABC Kuru Kimyevi Toz (Kırmızı) - Gerçekçi model
  loader.load(fileFE, function (gltf) {
    const abcModel = gltf.scene.clone();
    // Alarm butonu: x: -2.4, y: 1.4, z: 1.8
    // Duvara monte konumu
    abcModel.position.set(-2.35, 0.9, 1.6); // Alarmın biraz solu/altı
    abcModel.rotation.y = 0; // Duvara paralel/düz
    abcModel.scale.set(0.8, 0.8, 0.8);
    abcModel.name = "ABC";

    abcModel.traverse((child) => {
      const lowerName = child.name.toLowerCase();

      // El ve kol kısımlarını gizle
      if (
        lowerName.includes("hand") ||
        lowerName.includes("arm") ||
        lowerName.includes("finger") ||
        lowerName.includes("palm") ||
        lowerName.includes("wrist") ||
        lowerName.includes("glove") ||
        lowerName.includes("skin") ||
        lowerName.includes("human")
      ) {
        child.visible = false;
        return;
      }

      // Her child'a ABC ismini ver - raycaster için gerekli
      if (child.isMesh) {
        child.name = "ABC";
      } else {
        child.name = "ABC";
      }

      if (child.isMesh || child.isSkinnedMesh) {
        // Kırmızı renk - ABC tüpü (env kapalıyken de belirgin olsun)
        if (child.material) {
          child.material = child.material.clone();
          child.material.color = new THREE.Color(0xff0000);
          child.material.emissive = new THREE.Color(0x660000);
          child.material.emissiveIntensity = 0.35;
          child.material.metalness = 0.15;
          child.material.roughness = 0.5;
        }
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    room.add(abcModel);

    // Etiket kaldırıldı

    window.extinguishers = window.extinguishers || {};
    window.extinguishers.ABC = abcModel;

    console.log("ABC söndürücü yüklendi");
  });

  // CO2 Söndürücü (Siyah) - Gerçekçi model
  loader.load(fileFE, function (gltf) {
    const co2Model = gltf.scene.clone();
    // Alarm butonu: x: -2.4, y: 1.4, z: 1.8
    // Duvara monte konumu
    co2Model.position.set(-2.35, 0.9, 2.0); // Alarmın biraz sağı/altı
    co2Model.rotation.y = 0; // Duvara paralel/düz
    co2Model.scale.set(0.8, 0.8, 0.8);
    co2Model.name = "CO2";

    co2Model.traverse((child) => {
      const lowerName = child.name.toLowerCase();

      // El ve kol kısımlarını gizle
      if (
        lowerName.includes("hand") ||
        lowerName.includes("arm") ||
        lowerName.includes("finger") ||
        lowerName.includes("palm") ||
        lowerName.includes("wrist") ||
        lowerName.includes("glove") ||
        lowerName.includes("skin") ||
        lowerName.includes("human")
      ) {
        child.visible = false;
        return;
      }

      // Her child'a CO2 ismini ver - raycaster için gerekli
      if (child.isMesh) {
        child.name = "CO2";
      } else {
        child.name = "CO2";
      }

      if (child.isMesh || child.isSkinnedMesh) {
        // Siyah renk - CO2 tüpü (env kapalıyken de net siyah kalsın)
        if (child.material) {
          child.material = child.material.clone();
          child.material.color = new THREE.Color(0x1a1a1a);
          child.material.emissive = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
          child.material.metalness = 0.7;
          child.material.roughness = 0.4;
        }
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    room.add(co2Model);

    // Etiket kaldırıldı

    window.extinguishers = window.extinguishers || {};
    window.extinguishers.CO2 = co2Model;

    console.log("CO2 söndürücü yüklendi");
  });

  // Yangın Dolabı (Su sistemi) - GLB modeli createRoom() içinde yükleniyor
  // Fallback kaldırıldı - sadece fire_hose_cabinet.glb kullanılıyor
}

// Elektrik Panosu - Gerçekçi
function createElectricalPanel() {
  // ARKA KÖŞE - Sağ duvar (x=2.4, z=-1.8)
  const panelX = 2.4;
  const panelY = 1.2;
  const panelZ = -1.8;

  // Ana pano kutusu (gri metal)
  const panelGeometry = new THREE.BoxGeometry(0.12, 0.7, 0.5); // Döndürüldü
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.5,
    metalness: 0.6,
  });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.set(panelX, panelY, panelZ);
  panel.name = "electricalPanel";
  panel.castShadow = true;
  room.add(panel);

  // Pano kapağı (açık gri)
  const doorGeometry = new THREE.BoxGeometry(0.03, 0.65, 0.45); // Döndürüldü
  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.4,
    metalness: 0.5,
  });
  const door = new THREE.Mesh(doorGeometry, doorMaterial);
  door.position.set(panelX - 0.06, panelY, panelZ);
  room.add(door);

  // Tehlike işareti (sarı-siyah)
  const warningGeometry = new THREE.BoxGeometry(0.01, 0.15, 0.15); // Döndürüldü
  const warningMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdd00,
    emissive: 0x443300,
    emissiveIntensity: 0.4,
    roughness: 0.3,
  });
  const warning = new THREE.Mesh(warningGeometry, warningMaterial);
  warning.position.set(panelX - 0.08, panelY + 0.15, panelZ);
  room.add(warning);

  // Kırmızı çizgi (tehlike)
  const lineGeometry = new THREE.BoxGeometry(0.01, 0.02, 0.4); // Döndürüldü
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0x660000,
    emissiveIntensity: 0.3,
  });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.set(panelX - 0.08, panelY - 0.15, panelZ);
  room.add(line);

  // "ELEKTRİK PANOSU" yazı plakası
  const labelGeometry = new THREE.BoxGeometry(0.01, 0.06, 0.35); // Döndürüldü
  const labelMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    emissive: 0x111111,
    emissiveIntensity: 0.2,
  });
  const label = new THREE.Mesh(labelGeometry, labelMaterial);
  label.position.set(panelX - 0.08, panelY + 0.35, panelZ);
  room.add(label);

  // Kilit/mandal
  const lockGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8);
  const lockMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.9,
    roughness: 0.2,
  });
  const lock = new THREE.Mesh(lockGeometry, lockMaterial);
  lock.position.set(panelX - 0.08, panelY, panelZ + 0.15);
  lock.rotation.x = Math.PI / 2;
  room.add(lock);

  window.electricalPanel = panel;
}

// Yangın Dolabı - Gerçekçi (Kod ile)
function createFireHoseCabinet() {
  const x = 2.4; // Sağ duvarın yüzeyi
  const y = 1.0;
  const z = 1.5;

  const cabinetGroup = new THREE.Group();
  cabinetGroup.position.set(x, y, z);
  cabinetGroup.rotation.y = -Math.PI / 2; // Odaya bakacak
  cabinetGroup.name = "WATER";

  // 1. Ana Kasa (Kırmızı) - İçi boş kutu yapısı
  const cabinetMat = new THREE.MeshStandardMaterial({
    color: 0xaa0000, // Koyu kırmızı
    roughness: 0.3,
    metalness: 0.6
  });

  // Arka Panel
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.02), cabinetMat);
  backPanel.position.z = -0.09;
  backPanel.name = "WATER";
  cabinetGroup.add(backPanel);

  // Üst Panel
  const topPanel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.2), cabinetMat);
  topPanel.position.set(0, 0.39, 0);
  topPanel.name = "WATER";
  cabinetGroup.add(topPanel);

  // Alt Panel
  const bottomPanel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.2), cabinetMat);
  bottomPanel.position.set(0, -0.39, 0);
  bottomPanel.name = "WATER";
  cabinetGroup.add(bottomPanel);

  // Sol Panel
  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.2), cabinetMat);
  leftPanel.position.set(-0.39, 0, 0);
  leftPanel.name = "WATER";
  cabinetGroup.add(leftPanel);

  // Sağ Panel
  const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.2), cabinetMat);
  rightPanel.position.set(0.39, 0, 0);
  rightPanel.name = "WATER";
  cabinetGroup.add(rightPanel);

  // 2. Cam Kapak (Yarı saydam)
  const glassGeom = new THREE.BoxGeometry(0.7, 0.7, 0.02);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.3,
    roughness: 0.1,
    metalness: 0.9,
    transmission: 0.5,
    thickness: 0.02
  });
  const glass = new THREE.Mesh(glassGeom, glassMat);
  glass.position.z = 0.11; // Hafif önde
  glass.name = "WATER";
  cabinetGroup.add(glass);

  // 3. Çerçeve (Kapak çerçevesi)
  // Basitlik için kenarlara ek parçalar
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x880000 });
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.04, 0.04), frameMat);
  frameTop.position.set(0, 0.37, 0.11);
  cabinetGroup.add(frameTop);

  const frameBot = frameTop.clone();
  frameBot.position.set(0, -0.37, 0.11);
  cabinetGroup.add(frameBot);

  const frameSide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), frameMat);
  frameSide.position.set(0.37, 0, 0.11);
  cabinetGroup.add(frameSide);

  const frameSide2 = frameSide.clone();
  frameSide2.position.set(-0.37, 0, 0.11);
  cabinetGroup.add(frameSide2);

  // 4. Hortum Makarası (Gelişmiş Tasarım)
  const reelGroup = new THREE.Group();
  reelGroup.position.z = 0; // Merkeze yerleştir
  cabinetGroup.add(reelGroup);

  // Makara Göbeği
  const coreGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.14, 32);
  const reelColorMat = new THREE.MeshStandardMaterial({
    color: 0xaa0000,
    roughness: 0.5,
    metalness: 0.2
  });
  const core = new THREE.Mesh(coreGeom, reelColorMat);
  core.rotation.x = Math.PI / 2;
  reelGroup.add(core);

  // Makara Yan Diskleri (Hortumu tutan kısımlar)
  const discGeom = new THREE.CylinderGeometry(0.32, 0.32, 0.01, 32);

  const discLeft = new THREE.Mesh(discGeom, reelColorMat);
  discLeft.rotation.x = Math.PI / 2;
  discLeft.position.z = -0.07;
  reelGroup.add(discLeft);

  const discRight = discLeft.clone();
  discRight.position.z = 0.07;
  reelGroup.add(discRight);

  // 5. Sarılı Hortum (Çoklu halka ile sarmal görünümü)
  const hoseMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a, // Koyu siyah lastik rengi
    roughness: 0.9,
    metalness: 0.1
  });

  // Hortum katmanları
  // 3 Katman üst üste sarılmış hortum
  for (let layer = 0; layer < 3; layer++) {
    const radius = 0.16 + (layer * 0.04); // Her katmanda çap artıyor
    const tubeRadius = 0.02;

    // Her katmanda yan yana 3 tur
    for (let i = -1; i <= 1; i++) {
      const torusGeom = new THREE.TorusGeometry(radius, tubeRadius, 8, 24);
      const loop = new THREE.Mesh(torusGeom, hoseMat);
      loop.position.z = i * 0.035; // Yan yana diz
      // Hafif rastgele rotasyon ver ki doğal dursun
      loop.rotation.z = Math.random() * Math.PI;
      reelGroup.add(loop);
    }
  }

  // 6. Nozul / Lans (Hortum ucu)
  const nozzleGroup = new THREE.Group();
  nozzleGroup.position.set(0.15, -0.25, 0.05); // Sağ alt köşeye sarkmış
  nozzleGroup.rotation.z = -Math.PI / 3;

  // Nozul gövdesi
  const nozzleBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.03, 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.3 }) // Altın/Pirinç rengi
  );
  nozzleGroup.add(nozzleBody);

  // Nozul ucu (Kırmızı vana kısmı)
  const nozzleTip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.02, 0.05, 16),
    new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 })
  );
  nozzleTip.position.y = 0.08;
  nozzleGroup.add(nozzleTip);

  reelGroup.add(nozzleGroup);


  // 6. (Kaldırıldı) Eski beyaz uyarı levhası yerine direkt "YANGIN DOLABI" yazısı kullanılacak

  // 7. "YANGIN DOLABI" yazısı (CanvasTexture ile)
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const ctx = labelCanvas.getContext("2d");
  if (ctx) {
    // Arka plan
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, labelCanvas.width, labelCanvas.height);

    // Yazı
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("YANGIN DOLABI", labelCanvas.width / 2, labelCanvas.height / 2);
  }

  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.wrapS = THREE.ClampToEdgeWrapping;
  labelTexture.wrapT = THREE.ClampToEdgeWrapping;
  labelTexture.needsUpdate = true;

  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTexture,
    transparent: true,
  });

  // Levhanın fiziksel boyutu (genişlik x yükseklik)
  const labelWidth = 0.6;
  const labelHeight = 0.14;
  const labelGeom = new THREE.PlaneGeometry(labelWidth, labelHeight);
  const labelMesh = new THREE.Mesh(labelGeom, labelMat);
  // Mevcut beyaz levhanın hemen önüne, üst kısmına yerleştir
  labelMesh.position.set(0, 0.25, 0.135);
  cabinetGroup.add(labelMesh);

  room.add(cabinetGroup);

  window.extinguishers = window.extinguishers || {};
  window.extinguishers.WATER = cabinetGroup;
  console.log("✓ Gerçekçi yangın dolabı kod ile oluşturuldu");
}

// ----------------- Yangın Kontrol Fonksiyonları ------------------------

function startEarthquake() {
  if (!timerStarted) {
    timerStarted = true;
    startTime = Date.now();
  }

  earthquakeEnable = true;
  shakeEnable = true;
  earthquakeIntensity = 1.0;
  earthquakeStage = "beginning";
  nextDoorPenaltyAt = Date.now() + 1500;
  backpackCollected = false;
  Object.keys(safeZonesUsed).forEach((k) => {
    safeZonesUsed[k] = false;
  });
  if (scenarioEndOverlay) scenarioEndOverlay.style.display = "none";

  // Deprem başlayınca bardak kırılır: bardak gider, kırık bardak görünür
  if (loadedModels.glass && loadedModels.glass.parent) {
    loadedModels.glass.parent.remove(loadedModels.glass);
  }
  if (loadedModels.smashedGlass && !loadedModels.smashedGlass.parent) {
    room.add(loadedModels.smashedGlass);
  }

  // Elektrik kesintisi - Deprem nedeniyle
  cutElectricity();

  decisionLog.push({
    time: Date.now() - startTime,
    action: "earthquake_started",
    description: "Deprem başladı!",
  });

  console.log("🌍 Deprem başladı!");
}

// Elektriği kes
function cutElectricity() {
  electricityOn = false;

  // Normal ışıkları kapat
  if (window.mainLights) {
    window.mainLights.visible = false;
  }

  // Acil durum ışıklarını aç
  if (window.emergencyLights) {
    window.emergencyLights.visible = true;
  }

  // Arka plan koyu ama tam karanlık değil; eşyalar orijinal renklerini korusun
  scene.background = new THREE.Color(0x2a2540);
  scene.fog = new THREE.Fog(0x2a2540, 5, 14);

  // Ortam ışığı azaldığında malzemeler üzerindeki parlaklık/yansıma dursun
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const m = obj.material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    mats.forEach((mat) => {
      if (mat && typeof mat.metalness !== "undefined") mat.metalness = 0;
      if (mat && typeof mat.roughness !== "undefined") mat.roughness = 0.95;
    });
  });

  console.log(
    "💡 Kaçak akım rölesi devreye girdi! Sadece acil durum ışıkları yanıyor."
  );

}

// Mesaj göster
function showMessage(message, duration = 4000) {
  const messageDiv = document.getElementById("messageBox");
  if (messageDiv) {
    messageDiv.textContent = message;
    messageDiv.style.display = "block";

    setTimeout(() => {
      messageDiv.style.display = "none";
    }, duration);
  }
}


// ----------------- CSV EXPORT ------------------------

function exportToCSV(totalTime, score, resultText) {
  // Kullanıcı bilgisini al
  const user = window.userData || { name: "Bilinmeyen", surname: "Kullanıcı", startTime: new Date().toLocaleString() };

  // Excel'in sayıları "tarih" gibi otomatik biçimlendirmesini engellemek için
  // zamanı metin olarak yazdırıyoruz (örn: 00:12.3).
  function formatElapsedTime(seconds) {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const totalSecondsInt = Math.floor(safeSeconds);
    const tenths = Math.floor((safeSeconds - totalSecondsInt) * 10 + 1e-9); // 0-9

    const mins = Math.floor(totalSecondsInt / 60);
    const secs = totalSecondsInt % 60;

    const mm = String(mins).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    return `${mm}:${ss}.${tenths}`;
  }

  // CSV İçeriği Oluştur
  let csvContent = "\uFEFF"; // UTF-8 BOM (Excel için Türkçe karakter desteği)
  csvContent += "Deprem Eğitimi Simülasyon Raporu\n";
  csvContent += "--------------------------------\n";
  csvContent += `Ad Soyad;${user.name} ${user.surname}\n`;
  csvContent += `Tarih;${user.startTime}\n`;
  csvContent += `Toplam Süre;${totalTime} saniye\n`;
  csvContent += `Puan;${score}\n`;
  csvContent += `Sonuç;${resultText.replace(/\n/g, " ")}\n\n`;

  csvContent += "--------------------------------\n";
  csvContent += "DETAYLI HAREKET DÖKÜMÜ\n";
  csvContent += "Zaman (mm:ss.s);Eylem;Açıklama\n";

  // Logları ekle
  decisionLog.forEach(log => {
    // CSV formatına uygun hale getir (noktalı virgül çakışmasını önle)
    const timeSeconds = typeof log.time === 'number' ? (log.time / 1000) : Number(log.time);
    const timeFormatted = formatElapsedTime(timeSeconds);
    // Başına apostrof koyarak Excel'de "metin" kalmasını sağla (tarih/sayıya dönmesin)
    const time = `'${timeFormatted}`;
    const desc = log.description.replace(/;/g, ",");
    csvContent += `${time};${log.action};${desc}\n`;
  });

  // Dosya İndirme İşlemi
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  // Dosya adı: Ad_Soyad_Tarih.csv
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `Egitim_Raporu_${user.name}_${user.surname}_${dateStr}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ----------------- GUI ------------------------

function addGUI() {
  if (guiEnable) {
    gui = new GUI();
    guiCam = gui.addFolder("EarthquakeAR");

    // guiCam.add( guiObject, 'value1', 1, textureCount, 1 ).name('Texture');
    // guiCam.add( guiObject, 'value2', 0, 1 ).name('Box Brightness');
    guiCam.add(guiObject, "value3", 0, 10).name("Sahne Parlaklığı");
    // guiCam.add( guiObject, 'value4', 0, 1 ).name('Camera Damping');
    guiCam.addColor(guiObject, "color", 255).name("Zemin Rengi");
    guiCam.add(guiObject, "smokeBoolean").name("💨 Duman");
    // Yangın söndürücü kontrolü kaldırıldı - artık kola tıklayarak aktif edilecek
    // guiCam.add(guiObject, "feBoolean").name("🧯 Yangın Söndürücü");
    guiCam.add(guiObject, "pauseBoolean").name("⏸ Duraklat");

    gui.onChange((event) => {
      console.log(event.property);
      // FE animasyonu artık kola tıklayarak kontrol edilecek
      // if (event.property == "feBoolean" && guiObject.feBoolean == true)
      //   playFeAnimations();
      // else stopFeAnimations();
    });
  }
}

// ----------------- Stats ---------------------

const stats = () => {
  if (statsEnable) {
    const stats1 = new Stats();
    stats1.showPanel(0);
    const stats2 = new Stats();
    stats2.showPanel(1);
    stats2.dom.style.cssText = "position:absolute;top:0px;left:80px;";
    const stats3 = new Stats();
    stats3.showPanel(2);
    stats3.dom.style.cssText = "position:absolute;top:0px;left:160px;";
    document.body.appendChild(stats1.dom);
    document.body.appendChild(stats2.dom);
    document.body.appendChild(stats3.dom);

    function statsUpdate() {
      requestAnimationFrame(statsUpdate);
      stats1.update();
      stats2.update();
      stats3.update();
    }
    statsUpdate();
  }
};
stats();


function animate() {
  requestAnimationFrame(animate);

  deltaTime = clock.getDelta();

  controls.update();
  controls.dampingFactor = guiObject.value4;

  // WASD ile birinci şahıs hareket güncellemesi
  updateFirstPersonMovement(deltaTime);

  // Deprem sallanma efekti
  if (earthquakeEnable && guiObject.earthquakeBoolean) {
    const shakeIntensity = earthquakeIntensity * 0.05;
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity;
    camera.position.z += (Math.random() - 0.5) * shakeIntensity;
  }

  updateInteraction();

  // if (composer) {
  //   composer.render();
  // } else {
    renderer.render(scene, camera);
  // }

  if (mixerSmoke) {
    mixerSmoke.update(deltaTime);
    // console.log('mixerSmoke : ', mixerSmoke);
  }

  // baseCircle kaldırıldı
  // if (baseCircle)
  //   modelCircle.children[0].material.color = new THREE.Color(
  //     guiObject.color.r,
  //     guiObject.color.g,
  //     guiObject.color.b
  //   );

  if (!guiObject.pauseBoolean) {
    // Duman/partikül efekti kapalı (istenen değişiklik)
  }

  // Deprem aşamasını güncelle
  updateEarthquakeStage();
  updateScenarioProgress();

  // Deprem yoğunluğuna göre partikül oranını ayarla
  const intensityMultiplier = earthquakeStage === "developed" ? 1.8 : 1.0;
  // Duman/partikül oranlarını her koşulda sıfırla
  dustRate = 0;
  debrisRate = 0;

  // Zamanlayıcıyı göster (sadece senaryo devam ederken)
  if (timerStarted && !scenarioEnded && earthquakeStage !== "stopped") {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const remaining = Math.max(0, scenarioDurationMs / 1000 - elapsedSeconds).toFixed(1);
    const timerDiv = document.getElementById("timer");
    if (timerDiv) {
      timerDiv.textContent = `⏱️ Kalan Süre: ${remaining}s | Puan: ${userScore}`;

      // Renk değişimi - süreye göre
      if (remaining > 15) {
        timerDiv.style.color = "#00ff00";
      } else if (remaining > 7) {
        timerDiv.style.color = "#ffaa00";
      } else {
        timerDiv.style.color = "#ff0000";
      }
    }
  }

  // console.log('fireRate : ', fireRate);

  // modelFE.rotation.y += .01

  // Elleri sadeleştirilmiş şekilde sadece hareket/nefes animasyonu için göster
  if (handsGroup) {
    // Basit bir sallanma animasyonu (yürürken)
    if (moveState.forward || moveState.backward || moveState.left || moveState.right) {
      const time = Date.now() * 0.005;
      handsGroup.position.y = Math.sin(time) * 0.01;
      handsGroup.position.x = Math.cos(time * 0.5) * 0.005;
    } else {
      // Dururken yavaş nefes alma hareketi
      const time = Date.now() * 0.001;
      handsGroup.position.y = Math.sin(time) * 0.005;
    }
  }

  renderer.toneMappingExposure = guiObject.value3;
}

// ==================== ODA TURU ====================
let tourOverlay;

function showTourMessage(text, duration = 3000) {
  if (!tourOverlay) {
    tourOverlay = document.createElement("div");
    tourOverlay.style.position = "fixed";
    tourOverlay.style.bottom = "20%";
    tourOverlay.style.left = "50%";
    tourOverlay.style.transform = "translate(-50%, 0)";
    tourOverlay.style.backgroundColor = "rgba(0,0,0,0.8)";
    tourOverlay.style.color = "#00ff00";
    tourOverlay.style.padding = "20px 40px";
    tourOverlay.style.fontSize = "24px";
    tourOverlay.style.fontWeight = "bold";
    tourOverlay.style.borderRadius = "15px";
    tourOverlay.style.border = "2px solid #00ff00";
    tourOverlay.style.textAlign = "center";
    tourOverlay.style.zIndex = "10000";
    tourOverlay.style.transition = "opacity 0.5s";
    tourOverlay.style.pointerEvents = "none";
    document.body.appendChild(tourOverlay);
  }

  tourOverlay.textContent = text;
  tourOverlay.style.opacity = "1";
}

function hideTourMessage() {
  if (tourOverlay) tourOverlay.style.opacity = "0";
}

function tweenCameraLookAt(targetPos, targetLookAt, duration) {
  return new Promise((resolve) => {
    const startPos = camera.position.clone();

    // Mevcut bakış yönünü bul
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    const startLookAt = startPos.clone().add(forward.multiplyScalar(2)); // 2m ileriye bakıyor varsayalım

    const startTime = Date.now();

    function update() {
      const now = Date.now();
      let progress = (now - startTime) / duration;
      if (progress > 1) progress = 1;

      // Ease in out quadratic
      const ease =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Pozisyon enterpolasyonu
      camera.position.lerpVectors(startPos, targetPos, ease);

      // Bakış enterpolasyonu
      const currentLook = new THREE.Vector3().lerpVectors(
        startLookAt,
        targetLookAt,
        ease
      );
      camera.lookAt(currentLook);

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        resolve();
      }
    }
    update();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRoomTour() {
  if (roomTourStarted) return;
  if (!camera || !room || !controls) {
    setTimeout(() => {
      runRoomTour();
    }, 400);
    return;
  }
  roomTourStarted = true;
  console.log("🎬 Otomatik oda turu başlıyor...");

  // Kontrolleri kapalı tut
  if (controls) controls.unlock();

  const initialPos = new THREE.Vector3(0, 1.6, 2.0); // Başlangıç
  const centerPos = new THREE.Vector3(0, 1.6, 0.5); // Merkeze yakın

  const targets = [
    {
      // 1. Yatak
      pos: new THREE.Vector3(-0.5, 1.6, -1.5),
      look: new THREE.Vector3(-0.5, 0.6, -4.2),
      text: "🛏 Güvenli alanlardan biri: yatağın yanları.",
      wait: 1800,
    },
    {
      // 2. Masa
      pos: new THREE.Vector3(3.6, 1.6, -1.2),
      look: new THREE.Vector3(5.3, 0.9, -1.65),
      text: "🪑 Masanın altı depremde en güvenli yerlerden.",
      wait: 1800,
    },
    {
      // 3. Deprem Çantası
      pos: new THREE.Vector3(3.6, 1.6, -2.0),
      look: new THREE.Vector3(3.8, 0.3, -2.8),
      text: "🎒 Deprem çantasını görürsen E ile almayı unutma.",
      wait: 1800,
    },
    {
      // 4. Dolap
      pos: new THREE.Vector3(3.5, 1.6, 1.2),
      look: new THREE.Vector3(5.3, 1.0, 1.5),
      text: "🧱 Dolabın yanı da güvenli alan olarak kullanılabilir.",
      wait: 1800,
    },
    {
      // 5. Cam (tehlikeli)
      pos: new THREE.Vector3(0.0, 1.6, -0.8),
      look: new THREE.Vector3(-5.7, 1.7, 0.0),
      text: "⚠ CAM/PENCERE BÖLGESİNİ KULLANMAYIN!",
      wait: 2200,
    },
    {
      // 6. Kapı (tehlikeli)
      pos: new THREE.Vector3(0.0, 1.6, 0.8),
      look: new THREE.Vector3(0.0, 1.5, 5.8),
      text: "⚠ SARSINTI SIRASINDA KAPIYA YAKLAŞMAYIN!",
      wait: 2200,
    },
  ];

  for (const target of targets) {
    showTourMessage(target.text);
    await tweenCameraLookAt(target.pos, target.look, 1500); // 1.5 sn hareket
    await sleep(target.wait); // Bekle
  }

  // Başa dön
  hideTourMessage();
  showTourMessage("✅ Simülasyon Başlıyor! Hazır olun...", 2000);

  // Başlangıç pozisyonuna dön
  await tweenCameraLookAt(initialPos, new THREE.Vector3(0, 1.6, -2.0), 1500);

  await sleep(1000);
  hideTourMessage();

  // Başla butonunu göster
  const startBtn = document.getElementById("startScenarioBtn");
  if (startBtn) {
    startBtn.style.display = "block";

    // Butonu vurgula
    startBtn.style.transform = "translate(-50%, -50%) scale(1.1)";
    startBtn.style.transition = "transform 0.5s";
    setTimeout(() => {
      startBtn.style.transform = "translate(-50%, -50%) scale(1.0)";
    }, 500);
  }
}

// Senaryo başlatıcı
function startScenario() {
  scenarioEnded = false;
  timerStarted = false;
  userScore = 0;
  decisionLog = [];
  backpackCollected = false;
  if (loadedModels.backpack && loadedModels.backpack.parent !== room) {
    room.add(loadedModels.backpack);
  }
  if (loadedModels.smashedGlass && loadedModels.smashedGlass.parent) {
    loadedModels.smashedGlass.parent.remove(loadedModels.smashedGlass);
  }
  if (loadedModels.glass && !loadedModels.glass.parent) {
    room.add(loadedModels.glass);
  }
  if (scenarioEndOverlay) scenarioEndOverlay.style.display = "none";

  // Başlat butonunu hemen gizle
  const startBtn = document.getElementById("startScenarioBtn");
  if (startBtn) {
    startBtn.style.display = "none";
  }

  // Senaryo talimat penceresini otomatik kapat
  const instructionsDiv = document.getElementById("instructions");
  if (instructionsDiv && !instructionsDiv.classList.contains("collapsed")) {
    instructionsDiv.classList.add("collapsed");
  }

  // Deprem durumu penceresinde uyarı göster
  const statusDiv = document.getElementById("earthquakeStatus");
  if (statusDiv) {
    statusDiv.textContent = "🏢 Binaya giriyorsunuz...";
    statusDiv.style.color = "#ffffff";
    statusDiv.style.borderColor = "#ffffff";
  }

  setTimeout(() => {
    if (statusDiv) {
      statusDiv.textContent =
        "⚡ DEPREM BAŞLADI! 🌍 Çök-Kapan-Tut yapın!";
      statusDiv.style.color = "#ffff00";
      statusDiv.style.borderColor = "#ffff00";
      statusDiv.style.animation = "pulse 0.5s infinite";
    }

    startEarthquake();

    // Zamanlayıcıyı göster
    const timerDiv = document.getElementById("timer");
    if (timerDiv) {
      timerDiv.style.display = "block";
    }

    // İmleç kilidi: Pointer Lock kullanıcı jesti ister.
    // Kilidi, timerStarted olunca kullanıcı tıklamasıyla yapan mevcut event akışı halledecek.

    const crosshair = document.getElementById("crosshair");
    if (crosshair) {
      crosshair.style.display = "block";
    }
  }, 2000);
}

// Global fonksiyonları export et
window.earthquakeSimulation = {
  startEarthquake: startEarthquake,
  startScenario: startScenario,
  runRoomTour: runRoomTour,
};

// Sayfa yüklendiğinde Kontrol Bilgilendirme Ekranını göster
window.addEventListener("load", () => {
  setTimeout(() => {
    // Kontrolleri serbest bırak (Mouse görünsün)
    if (controls) controls.unlock();

    // Önce Kullanım Kılavuzu Ekranını Göster
    const controlsIntro = document.getElementById("controls-intro");
    if (controlsIntro) {
      controlsIntro.style.display = "block";
    }
  }, 1000);
});

// Etkileşim kontrolü (her karede çalışır)
function updateInteraction() {
  if (!controls.isLocked || scenarioEnded || !timerStarted) {
    if (interactionHintDiv) interactionHintDiv.style.display = 'none';
    return;
  }

  const raycaster = new THREE.Raycaster();
  // Ekranın tam ortasından ray at
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  let foundInteractable = null;
  let hintText = "";

  // 1. Sahne objelerini kontrol et (Alarm, Tüpler)
  if (room) {
    const intersects = raycaster.intersectObjects(room.children, true);
    if (intersects.length > 0) {
      // En yakın objeyi al
      const object = intersects[0].object;

      // Mesafe kontrolü
      if (intersects[0].distance < 3.0) { // 3 metre etkileşim mesafesi
        if (object.name === "Door") {
          foundInteractable = { type: "door" };
          hintText = "🚪 KAPI İLE ETKİLEŞ [E]";
        } else if (object.userData?.interactableKey === "window1") {
          foundInteractable = { type: "window" };
          hintText = "🪟 PENCEREYLE ETKİLEŞ [E] (TEHLİKELİ)";
        } else if (
          object.userData?.interactableKey === "backpack" &&
          !backpackCollected
        ) {
          foundInteractable = { type: "backpack" };
          hintText = "🎒 DEPREM ÇANTASINI AL [E]";
        }
      }
    }
  }

  if (!foundInteractable) {
    const zoneEntries = Object.entries(SAFE_ZONE_CONFIG);
    let bestZone = null;
    let bestDist = Infinity;
    for (const [key, zone] of zoneEntries) {
      if (safeZonesUsed[key]) continue;
      const dist = camera.position.distanceTo(zone.center);
      if (dist < 1.25 && dist < bestDist) {
        bestZone = key;
        bestDist = dist;
      }
    }
    if (bestZone) {
      foundInteractable = { type: "safezone", key: bestZone };
      const zone = SAFE_ZONE_CONFIG[bestZone];
      hintText = `🛡 ${zone.label} güvenli alanına geç [E] (+${zone.points})`;
    }
  }

  // Durumu güncelle
  currentInteractable = foundInteractable;

  // UI Güncelleme
  // Hint div'i henüz oluşturulmadıysa oluştur
  if (!interactionHintDiv) {
    interactionHintDiv = document.createElement('div');
    interactionHintDiv.style.position = 'fixed';
    interactionHintDiv.style.top = '55%'; // Ortadan biraz aşağıda
    interactionHintDiv.style.left = '50%';
    interactionHintDiv.style.transform = 'translate(-50%, -50%)';
    interactionHintDiv.style.color = '#ffffff';
    interactionHintDiv.style.fontFamily = 'Arial, sans-serif';
    interactionHintDiv.style.fontSize = '18px';
    interactionHintDiv.style.fontWeight = 'bold';
    interactionHintDiv.style.textShadow = '0px 0px 5px #000000';
    interactionHintDiv.style.pointerEvents = 'none';
    interactionHintDiv.style.display = 'none';
    interactionHintDiv.style.zIndex = '1000';
    document.body.appendChild(interactionHintDiv);
  }

  if (currentInteractable) {
    interactionHintDiv.textContent = hintText;
    interactionHintDiv.style.display = 'block';
    const crosshair = document.getElementById("crosshair");
    if (crosshair) crosshair.style.backgroundColor = "rgba(255, 255, 0, 0.9)";
  } else {
    interactionHintDiv.style.display = 'none';
    const crosshair = document.getElementById("crosshair");
    if (crosshair) crosshair.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
  }
}

// Deprem aşamasını güncelle
function updateEarthquakeStage() {
  const elapsed = Date.now() - startTime;

  if (elapsed > 12000 && earthquakeStage === "beginning") {
    earthquakeStage = "developed";
    earthquakeIntensity = 1.5;
    fallingObjectsActive = true;
    console.log("🌍 Deprem şiddetlendi!");
  }
}

function updateScenarioProgress() {
  if (!timerStarted || scenarioEnded) return;

  const now = Date.now();
  const elapsed = now - startTime;

  // Sarsıntı anında kapıya yaklaşma cezası
  const doorDistance = Math.hypot(camera.position.x, camera.position.z - ROOM_SIZE / 2);
  if (earthquakeEnable && doorDistance < 1.6 && now >= nextDoorPenaltyAt) {
    addScore(-10, "Deprem anında kapıya yaklaşma cezası (-10)");
    nextDoorPenaltyAt = now + 2500;
    showMessage("⚠ Sarsıntıda kapıya yaklaşmak tehlikeli! -10 puan", 1400);
  }

  // 25 saniye sonunda oyun biter
  if (elapsed >= scenarioDurationMs) {
    endScenario("SENARYO BİTTİ", "time_up");
  }
}

// Uygulamayı başlat: aksi halde sayfa yalnızca statik HTML olarak kalır.
initApp().catch((err) => {
  console.error("❌ initApp hatası:", err);
});