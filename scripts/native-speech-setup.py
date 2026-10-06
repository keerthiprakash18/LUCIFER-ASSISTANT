import os
import sys
from huggingface_hub import snapshot_download
from faster_whisper import WhisperModel

root=os.path.abspath(sys.argv[1])
os.environ['HF_HUB_DISABLE_XET']='1'
folder=os.path.join(root,'.local','native','models','whisper-small')
snapshot_download('Systran/faster-whisper-small',revision='536b0662742c02347bc0e980a01041f333bce120',local_dir=folder,
                  allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt'],token=False)
model=WhisperModel(folder,device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
print('Local multilingual Whisper small/int8 loaded successfully. No speech API credential is used.')
