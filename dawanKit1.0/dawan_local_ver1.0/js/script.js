// グローバル変数
var isThinking = false;
var LIVE_OWNER_ID = createUuid();
var recognition = null;
var isRecording = false;
var typingGeneration = 0;

// UUID生成
function createUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (a) {
        let r = (new Date().getTime() + Math.random() * 16) % 16 | 0, v = a == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 音声入力機能
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();

        recognition.lang = 'ja-JP';
        recognition.continuous = true; // 連続音声認識をオンにする
        recognition.interimResults = true;

        recognition.onstart = function() {
            isRecording = true;
            const voiceButton = document.getElementById('voiceButton');
            voiceButton.classList.add('recording');
            voiceButton.textContent = '🔴';
            document.getElementById('utterance').placeholder = '音声を認識中... (ボタンを押して停止)';
        };

        recognition.onresult = function(event) {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            document.getElementById('utterance').value = transcript;

            // 末尾が「どうぞ」なら自動送信
            if (transcript.trimEnd().endsWith('どうぞ')) {
                const cleanMessage = transcript.trimEnd().slice(0, -3).trimEnd();
                document.getElementById('utterance').value = cleanMessage;
                stopVoiceRecording();
                recognition.stop();
                onClickSend();
            }
        };

        recognition.onend = function() {
            // 手動で停止された場合のみ録音状態を解除
            if (isRecording) {
                // 自動的に再開しようとする場合は再開
                try {
                    recognition.start();
                } catch (e) {
                    console.log('音声認識の再開に失敗:', e);
                    // 再開に失敗した場合は録音状態を解除
                    stopVoiceRecording();
                }
            }
        };

        recognition.onerror = function(event) {
            console.error('音声認識エラー:', event.error);

            const userCommentElement = document.querySelector("#userComment");
            if (event.error === 'not-allowed') {
                userCommentElement.textContent = 'マイクの使用が許可されていません。ブラウザの設定を確認してください。';
                stopVoiceRecording();
            } else if (event.error === 'no-speech') {
                // 無音の場合は継続
                userCommentElement.textContent = '音声を検出中...';
            } else {
                userCommentElement.textContent = '音声認識でエラーが発生しました: ' + event.error;
                stopVoiceRecording();
            }
        };

        return true;
    } else {
        console.warn('このブラウザは音声認識をサポートしていません');
        return false;
    }
}

// 音声録音を停止する関数
function stopVoiceRecording() {
    isRecording = false;
    const voiceButton = document.getElementById('voiceButton');
    voiceButton.classList.remove('recording');
    voiceButton.textContent = '🎤';
    document.getElementById('utterance').placeholder = 'メッセージを入力してください...';
}

// 音声入力の開始/停止
function toggleVoiceInput() {
    if (!recognition) {
        const userCommentElement = document.querySelector("#userComment");
        userCommentElement.textContent = 'このブラウザは音声認識をサポートしていません';
        return;
    }

    if (isRecording) {
        // 手動停止
        stopVoiceRecording();
        recognition.stop();
    } else {
        // 開始
        try {
            recognition.start();
        } catch (e) {
            console.error('音声認識の開始に失敗:', e);
        }
    }
}

// タイプライター効果
function startTyping(param) {
    typingGeneration++;
    const myGen = typingGeneration;

    let el = document.querySelector(param.el);
    el.textContent = "";
    el.classList.add('typing-cursor');

    let speed = param.speed;
    let string = param.string;
    let index = 0;

    const typeChar = () => {
        if (myGen !== typingGeneration) return; // 新しい呼び出しがあればキャンセル

        if (index < string.length) {
            el.textContent = string.substring(0, index + 1);
            index++;
            if (typeof playTypeSound === 'function' && index % 4 === 0) playTypeSound();

            // AIレスポンスボックスを最下部にスクロール
            const aiResponseBox = document.querySelector('.aiResponseBox');
            if (aiResponseBox) {
                aiResponseBox.scrollTop = aiResponseBox.scrollHeight;
            }

            setTimeout(typeChar, speed);
        } else {
            el.classList.remove('typing-cursor');

            // タイピング完了後も最下部にスクロール
            const aiResponseBox = document.querySelector('.aiResponseBox');
            if (aiResponseBox) {
                aiResponseBox.scrollTop = aiResponseBox.scrollHeight;
            }

            if (typeof param.onComplete === 'function') param.onComplete();
        }
    };

    typeChar();
}

// MEBO APIからレスポンスを取得
async function getMeboResponse(utterance, username, uid, apikey, agentId) {
    var requestBody = {
        'api_key': apikey,
        'agent_id': agentId,
        'utterance': utterance,
        'username': username,
        'uid': uid,
    }

    try {
        const response = await fetch('https://api-mebo.dev/api', {
            method: 'post',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const content = await response.json();
        return content.bestResponse.utterance;
    } catch (error) {
        console.error('MEBO API Error:', error);
        return 'すみません、少し調子が悪いみたいです。もう一度試してくださいね。';
    }
}

// 文章整形
function formatResponse(text) {
    return text
        .replace(/([。！？])/g, '$1\n')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
}

// コメント処理
async function handleComment(comment, username) {
    if (isThinking) return;

    isThinking = true;
    const sendButton = document.getElementById('sendButton');
    const voiceButton = document.getElementById('voiceButton');
    const utteranceInput = document.getElementById('utterance');
    const userCommentElement = document.querySelector("#userComment");

    sendButton.disabled = true;
    sendButton.innerHTML = '<div class="loading"></div>';
    voiceButton.disabled = true;
    utteranceInput.disabled = true;
    userCommentElement.textContent = username + ": " + comment;

    // キーワードに基づいて適切な画像を選択
    const selectedImage = getImageForComment(comment);
    changeCharacterImage(selectedImage);

    document.querySelector("#aiResponseUtterance").textContent = "そうだワンね...";

    function reEnableInput() {
        isThinking = false;
        sendButton.disabled = false;
        sendButton.textContent = '送信';
        voiceButton.disabled = false;
        utteranceInput.disabled = false;
    }

    try {
        const response = await getMeboResponse(comment, username, LIVE_OWNER_ID, MEBO_API_KEY, MEBO_AGENT_ID);
        const formattedResponse = formatResponse(response);

        // タイプライター効果で表示（開始直後に入力解除して割り込み可能に）
        startTyping({
            el: "#aiResponseUtterance",
            string: formattedResponse,
            speed: 80
        });
        reEnableInput();

    } catch (error) {
        console.error('Error handling comment:', error);
        document.querySelector("#aiResponseUtterance").textContent = 'エラーが発生しました。もう一度お試しください。';
        reEnableInput();
    }
}

// 送信処理
function onClickSend() {
    const utteranceInput = document.querySelector("#utterance");
    const message = utteranceInput.value.trim();

    if (message === '' || isThinking) return;

    if (typeof playSendSound === 'function') playSendSound();
    handleComment(message, 'あなた');
    utteranceInput.value = "";
    utteranceInput.blur();
}

// まばたき機能
const blinkImageMap = {
    "image/character001.png": "image/character001_off.png",
    "image/character004.png": "image/character004_off.png",
    "image/character005.png": "image/character005_off.png"
};
var isBlinking = false;

function blink() {
    const charaImg = document.getElementById("charaImg");
    if (!charaImg) return;

    const offImage = blinkImageMap[currentBaseImage];

    if (!offImage) {
        // まばたき画像がないキャラはタイミングだけ待って次へ
        setTimeout(blink, 3000 + Math.random() * 3000);
        return;
    }

    if (isBlinking) {
        // 目を開ける
        isBlinking = false;
        charaImg.src = currentBaseImage;
        setTimeout(blink, 3000 + Math.random() * 3000);
    } else {
        // 目を閉じる
        isBlinking = true;
        charaImg.src = offImage;
        setTimeout(blink, 100 + Math.random() * 100);
    }
}

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    // 音声認識の初期化
    const speechSupported = initSpeechRecognition();
    if (!speechSupported) {
        const voiceButton = document.getElementById('voiceButton');
        voiceButton.style.opacity = '0.5';
        voiceButton.title = 'このブラウザは音声認識をサポートしていません';
    }

    // 定型メッセージメニューの初期化
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    if (typeof PRESET_MESSAGES !== 'undefined' && hamburgerMenu) {
        PRESET_MESSAGES.forEach(message => {
            const menuItem = document.createElement('div');
            menuItem.className = 'menu-item';
            menuItem.textContent = message;
            menuItem.onclick = function() {
                selectPresetMessage(message);
            };
            hamburgerMenu.appendChild(menuItem);
        });
    }

    // Enterキー送信
    const utteranceInput = document.querySelector("#utterance");
    utteranceInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onClickSend();
        }
    });

    // 起動時のランダム挨拶
    if (typeof GREETING_MESSAGES !== 'undefined' && GREETING_MESSAGES.length > 0) {
        const randomGreeting = GREETING_MESSAGES[Math.floor(Math.random() * GREETING_MESSAGES.length)];
        document.getElementById('aiResponseUtterance').textContent = randomGreeting;
    }

    // 初期フォーカス
    utteranceInput.focus();

    // まばたき開始
    blink();

    // キーボード表示時にBottomBoxを押し上げる（Android Chrome対応）
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function() {
            const keyboardHeight = window.innerHeight - window.visualViewport.height;
            document.querySelector('.bottomBox').style.bottom = keyboardHeight + 'px';
        });
    }
});

// ハンバーガーメニューの開閉
function toggleHamburgerMenu() {
    const menu = document.getElementById('hamburgerMenu');
    menu.classList.toggle('show');
}

// 定型文選択
function selectPresetMessage(message) {
    const utteranceInput = document.getElementById('utterance');
    utteranceInput.value = message;
    utteranceInput.focus();

    // メニューを閉じる
    const menu = document.getElementById('hamburgerMenu');
    menu.classList.remove('show');
}

// メニュー外クリックで閉じる
document.addEventListener('click', function(event) {
    const menu = document.getElementById('hamburgerMenu');
    const menuButton = document.getElementById('menuButton');

    if (!menu.contains(event.target) && !menuButton.contains(event.target)) {
        menu.classList.remove('show');
    }
});

