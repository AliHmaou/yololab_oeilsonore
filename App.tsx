
import React, { useState, useRef, useEffect, useCallback } from 'react';

// TypeScript declarations for global variables from script tags
declare const cocoSsd: {
  load: () => Promise<ObjectDetection>;
};

interface Prediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

interface ObjectDetection {
  detect: (video: HTMLVideoElement) => Promise<Prediction[]>;
}

const DETECTION_COOLDOWN = 2000; // 2 seconds

// A simple spinner component for loading states
const Spinner: React.FC = () => (
    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

const App: React.FC = () => {
    const [status, setStatus] = useState("Initialisation...");
    const [targetObject, setTargetObject] = useState("door");
    const [isDetecting, setIsDetecting] = useState(false);
    const [model, setModel] = useState<ObjectDetection | null>(null);
    const [isReady, setIsReady] = useState(false);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoContainerRef = useRef<HTMLDivElement>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const lastVibrationTimeRef = useRef(0);
    const animationFrameIdRef = useRef<number | null>(null);
    const isDetectingRef = useRef(false);

    // Main initialization effect for camera and AI model
    useEffect(() => {
        const initialize = async () => {
            // 1. Setup Camera
            setStatus("Recherche de la meilleure caméra...");
            let stream: MediaStream | null = null;
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                const wideCamera = videoDevices.find(device => 
                    device.label.toLowerCase().includes('wide') || 
                    device.label.toLowerCase().includes('ultra')
                );

                let videoConstraints: MediaTrackConstraints = {};
                if (wideCamera) {
                    setStatus("Caméra large détectée. Accès...");
                    videoConstraints.deviceId = { exact: wideCamera.deviceId };
                } else {
                    setStatus("Accès à la caméra standard...");
                    videoConstraints.facingMode = { exact: 'environment' };
                }
                stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
            } catch (err) {
                console.warn("Failed to get specific camera, falling back.", err);
                setStatus("Bascule vers la caméra par défaut...");
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
                } catch (fallbackErr) {
                    console.error("Camera access error (fallback): ", fallbackErr);
                    setStatus("Erreur: Impossible d'accéder à la caméra.");
                    alert("Impossible d'accéder à la caméra. Veuillez autoriser l'accès.");
                    return;
                }
            }

            if (videoRef.current && stream) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                    if (videoRef.current && videoContainerRef.current) {
                        videoContainerRef.current.style.height = `${videoRef.current.offsetHeight}px`;
                    }
                };
            }

            // 2. Load AI Model
            setStatus("Chargement du modèle d'IA...");
            try {
                const loadedModel = await cocoSsd.load();
                setModel(loadedModel);
                setStatus("Modèle chargé. Prêt à démarrer.");
                setIsReady(true);
            } catch (err) {
                console.error("Error loading model: ", err);
                setStatus("Erreur: Impossible de charger le modèle.");
            }
        };

        initialize();
    }, []);

    const playBeep = () => {
        if (!audioCtxRef.current) return;
        const oscillator = audioCtxRef.current.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtxRef.current.currentTime);
        oscillator.connect(audioCtxRef.current.destination);
        oscillator.start();
        oscillator.stop(audioCtxRef.current.currentTime + 0.1);
    };

    const detectObjects = useCallback(async () => {
        if (!isDetectingRef.current || !model || !videoRef.current || videoRef.current.readyState < 3) {
            return;
        }

        const predictions = await model.detect(videoRef.current);
        
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (canvas && video) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

                predictions.forEach(prediction => {
                    ctx.strokeStyle = '#00FF00';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(prediction.bbox[0], prediction.bbox[1], prediction.bbox[2], prediction.bbox[3]);
                    ctx.fillStyle = '#00FF00';
                    ctx.font = 'bold 18px Arial';
                    const text = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
                    ctx.fillText(text, prediction.bbox[0], prediction.bbox[1] > 20 ? prediction.bbox[1] - 5 : 20);
                });
            }
        }
        
        const target = targetObject.trim().toLowerCase();
        if (target !== '') {
            const found = predictions.find(p => p.class.toLowerCase() === target && p.score > 0.60);
            if (found) {
                setStatus(`✅ ${targetObject} détecté !`);
                const now = Date.now();
                if (now - lastVibrationTimeRef.current > DETECTION_COOLDOWN) {
                    if ('vibrate' in navigator) {
                        navigator.vibrate(200);
                    }
                    playBeep();
                    lastVibrationTimeRef.current = now;
                }
            } else {
                 setStatus(`Recherche de "${targetObject}"...`);
            }
        }

        animationFrameIdRef.current = requestAnimationFrame(detectObjects);
    }, [model, targetObject]);

    useEffect(() => {
        isDetectingRef.current = isDetecting;

        if (isDetecting) {
            detectObjects();
        } else {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx?.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        return () => {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
        };
    }, [isDetecting, detectObjects]);
    
    const handleToggleDetection = () => {
        if (!isReady) return;
        if (!audioCtxRef.current) {
             audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const nextIsDetecting = !isDetecting;
        setIsDetecting(nextIsDetecting);

        if (nextIsDetecting) {
            setStatus(`Recherche de "${targetObject}"...`);
        } else {
            setStatus("Analyse arrêtée.");
        }
    };

    return (
        <div className="bg-gray-900 text-white flex flex-col items-center justify-center min-h-screen p-4 font-sans">
            <div className="w-full max-w-lg text-center">
                <h1 className="text-3xl font-bold mb-2">L'Œil Sonore</h1>
                <p className="bg-blue-600 text-white py-2 px-4 rounded-lg mb-4 h-10 flex items-center justify-center text-sm">
                    {!isReady && <Spinner />} {status}
                </p>

                <div ref={videoContainerRef} id="video-container" className="relative bg-gray-700 rounded-xl shadow-lg overflow-hidden mb-4 w-full aspect-video">
                    <video ref={videoRef} id="video" autoPlay playsInline muted className="absolute top-0 left-0 w-full h-full object-cover"></video>
                    <canvas ref={canvasRef} id="canvas" className="absolute top-0 left-0 w-full h-full"></canvas>
                </div>

                <div className="bg-gray-800 p-4 rounded-xl shadow-lg w-full">
                    <div className="mb-4">
                        <label htmlFor="object-input" className="block mb-2 text-sm font-medium text-gray-300">Objet à détecter (en anglais):</label>
                        <input 
                            type="text" 
                            id="object-input" 
                            value={targetObject}
                            onChange={(e) => setTargetObject(e.target.value)}
                            className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        />
                    </div>
                    <button 
                        id="start-button" 
                        onClick={handleToggleDetection}
                        disabled={!isReady}
                        className={`w-full font-bold py-3 px-4 rounded-lg transition-colors text-lg ${
                            isDetecting
                                ? 'bg-red-600 hover:bg-red-700'
                                : 'bg-green-600 hover:bg-green-700'
                        } disabled:bg-gray-500 disabled:cursor-not-allowed`}
                    >
                        {isDetecting ? "Arrêter l'analyse" : "Démarrer l'analyse"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default App;
